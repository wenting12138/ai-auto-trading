/**
 * ai-auto-trading - AI 加密货币自动交易系统
 * Copyright (C) 2025 losesky
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * 不一致状态自动修复服务
 * 定期检查并尝试修复数据不一致问题
 */
import { createClient } from "@libsql/client";
import { getExchangeClient } from "../exchanges";
import { createLogger } from "../utils/logger";
import { getQuantoMultiplier } from "../utils/contractUtils";
import { emailAlertService, AlertLevel } from "../utils/emailAlert";

const logger = createLogger({
  name: "inconsistent-state-resolver",
  level: "info",
});

const dbClient = createClient({
  url: process.env.DATABASE_URL || "file:./.voltagent/trading.db",
});

/**
 * 修复失败追踪器
 */
class ResolveFailureTracker {
  private consecutiveFailures = 0;
  private failedStates: Map<number, number> = new Map(); // state.id -> failure count

  /**
   * 记录修复失败
   */
  recordFailure(stateId: number) {
    const count = (this.failedStates.get(stateId) || 0) + 1;
    this.failedStates.set(stateId, count);
    this.consecutiveFailures++;

    // 单个状态连续失败超过5次
    if (count >= 5) {
      emailAlertService.sendAlert({
        level: AlertLevel.ERROR,
        title: '自动修复连续失败',
        message: `状态ID ${stateId} 已连续修复失败 ${count} 次，需要人工介入`,
        details: {
          stateId,
          failureCount: count,
          consecutiveTotalFailures: this.consecutiveFailures,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * 记录修复成功
   */
  recordSuccess(stateId: number) {
    this.failedStates.delete(stateId);
    this.consecutiveFailures = 0;
  }

  /**
   * 检查是否需要整体告警
   */
  checkOverallFailures() {
    // 连续失败超过10次（多个不同状态）
    if (this.consecutiveFailures >= 10) {
      const failedCount = this.failedStates.size;
      emailAlertService.sendAlert({
        level: AlertLevel.CRITICAL,
        title: '自动修复系统异常',
        message: `自动修复服务已连续失败 ${this.consecutiveFailures} 次，涉及 ${failedCount} 个不同状态，系统可能存在严重问题`,
        details: {
          consecutiveFailures: this.consecutiveFailures,
          affectedStates: failedCount,
          failedStateIds: Array.from(this.failedStates.keys()),
          timestamp: new Date().toISOString()
        }
      });
    }
  }
}

const failureTracker = new ResolveFailureTracker();

/**
 * 不一致状态自动修复类
 */
export class InconsistentStateResolver {
  private resolveInterval: NodeJS.Timeout | null = null;

  /**
   * 启动自动修复服务
   */
  async start() {
    if (this.resolveInterval) {
      logger.warn('自动修复服务已在运行');
      return;
    }

    const intervalMinutes = parseInt(process.env.RESOLVE_INTERVAL_MINUTES || '10');
    logger.info(`启动不一致状态自动修复服务，检测间隔: ${intervalMinutes}分钟`);

    // 立即执行第一次
    await this.resolveInconsistentStates();

    // 定期执行
    this.resolveInterval = setInterval(async () => {
      await this.resolveInconsistentStates();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * 停止自动修复服务
   */
  stop() {
    if (this.resolveInterval) {
      clearInterval(this.resolveInterval);
      this.resolveInterval = null;
      logger.info('自动修复服务已停止');
    }
  }

  /**
   * 解决不一致状态
   */
  private async resolveInconsistentStates() {
    try {
      // 查询所有未解决的不一致状态
      const result = await dbClient.execute({
        sql: `SELECT * FROM inconsistent_states 
              WHERE resolved = 0 
              ORDER BY created_at ASC`
      });

      if (result.rows.length === 0) {
        logger.debug('没有待解决的不一致状态');
        return;
      }

      logger.info(`发现 ${result.rows.length} 个待解决的不一致状态，开始处理...`);

      for (const row of result.rows) {
        const state: any = row;
        
        try {
          const resolved = await this.resolveState(state);
          
          if (resolved) {
            // 标记为已解决
            await dbClient.execute({
              sql: `UPDATE inconsistent_states 
                    SET resolved = 1, resolved_at = ?, resolved_by = 'auto'
                    WHERE id = ?`,
              args: [new Date().toISOString(), state.id]
            });
            logger.info(`✅ 已自动修复不一致状态 #${state.id}: ${state.operation} ${state.symbol}`);
            failureTracker.recordSuccess(state.id);
          } else {
            failureTracker.recordFailure(state.id);
          }
        } catch (error: any) {
          logger.error(`❌ 修复不一致状态 #${state.id} 失败:`, error.message);
          failureTracker.recordFailure(state.id);
        }
      }
      
      // 检查整体失败情况
      failureTracker.checkOverallFailures();
    } catch (error: any) {
      logger.error('处理不一致状态失败:', error);
    }
  }

  /**
   * 解决单个不一致状态
   */
  private async resolveState(state: any): Promise<boolean> {
    const exchangeClient = getExchangeClient();

    // 根据操作类型分别处理
    switch (state.operation) {
      case 'close_position':
        return await this.resolveClosePosition(state, exchangeClient);
      
      case 'price_order_triggered':
        return await this.resolvePriceOrderTriggered(state, exchangeClient);
      
      case 'price_order_triggered_no_trade':
        // 条件单触发但未能记录成交明细（由 priceOrderMonitor 写入）
        return await this.resolvePriceOrderTriggeredNoTrade(state, exchangeClient);
      
      default:
        logger.warn(`未知的操作类型: ${state.operation}`);
        return false;
    }
  }

  /**
   * 修复平仓操作不一致
   * 
   * 情况: 交易所已平仓，但数据库记录失败
   * 策略: 补充数据库记录
   */
  private async resolveClosePosition(state: any, exchangeClient: any): Promise<boolean> {
    const { symbol, side, exchange_order_id } = state;

    logger.info(`🔧 修复平仓不一致: ${symbol} ${side}`);

    try {
      // 1. 验证交易所确实已平仓
      const positions = await exchangeClient.getPositions();
      const contract = exchangeClient.normalizeContract(symbol);
      
      const parsePositionSize = (size: any): number => {
        if (typeof size === 'number') return size;
        if (typeof size === 'string') {
          const parsed = Number.parseFloat(size);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };
      
      const positionExists = positions.some((p: any) => 
        p.contract === contract && Math.abs(parsePositionSize(p.size)) > 0
      );

      if (positionExists) {
        logger.warn(`${symbol} 持仓仍存在，无需修复`);
        return false;
      }

      // 2. 查询交易所的成交记录
      const trades = await exchangeClient.getMyTrades(contract, 100);
      const closeTrade = trades.find((t: any) => 
        (t.orderId?.toString() === exchange_order_id) ||
        (t.order_id?.toString() === exchange_order_id) ||
        (t.id?.toString() === exchange_order_id)
      );

      if (!closeTrade) {
        logger.warn(`未找到订单 ${exchange_order_id} 的成交记录`);
        return false;
      }

      // 3. 查询开仓信息（用于计算盈亏）
      const openTradeResult = await dbClient.execute({
        sql: `SELECT * FROM trades 
              WHERE symbol = ? AND side = ? AND type = 'open' 
              ORDER BY timestamp DESC LIMIT 1`,
        args: [symbol, side]
      });

      if (openTradeResult.rows.length === 0) {
        logger.warn(`未找到 ${symbol} ${side} 的开仓记录`);
        return false;
      }

      const openTrade: any = openTradeResult.rows[0];
      const entryPrice = parseFloat(openTrade.price);
      const exitPrice = parseFloat(closeTrade.price);
      const quantity = Math.abs(parseFloat(closeTrade.size || closeTrade.qty || '0'));
      const leverage = openTrade.leverage || 1;

      // 4. 计算盈亏
      const grossPnl = await exchangeClient.calculatePnl(
        entryPrice, exitPrice, quantity, side, contract
      );

      const contractType = exchangeClient.getContractType();
      let positionValue: number;
      
      if (contractType === 'inverse') {
        const quantoMultiplier = await getQuantoMultiplier(contract);
        positionValue = quantity * quantoMultiplier * exitPrice;
      } else {
        positionValue = quantity * exitPrice;
      }

      const totalFee = positionValue * 0.001; // 0.1%
      const netPnl = grossPnl - totalFee;
      
      // 🔧 核心修复：盈亏百分比计算
      // 盈亏百分比 = (净盈亏 / 保证金) * 100
      // 保证金 = 持仓价值 / 杠杆
      let pnlPercent: number;
      
      if (contractType === 'inverse') {
        // Gate.io 币本位合约：持仓价值 = 张数 * 合约乘数 * 开仓价
        const quantoMultiplier = await getQuantoMultiplier(contract);
        const openPositionValue = quantity * quantoMultiplier * entryPrice;
        const margin = openPositionValue / leverage;
        pnlPercent = (netPnl / margin) * 100;
      } else {
        // Binance USDT 正向合约：持仓价值 = 数量 * 开仓价
        const openPositionValue = quantity * entryPrice;
        const margin = openPositionValue / leverage;
        pnlPercent = (netPnl / margin) * 100;
      }

      // 5. 开启事务补充数据库记录
      const timestamp = new Date().toISOString();
      await dbClient.execute('BEGIN TRANSACTION');

      try {
        // 删除持仓记录
        await dbClient.execute({
          sql: 'DELETE FROM positions WHERE symbol = ? AND side = ?',
          args: [symbol, side]
        });

        // 更新条件单状态
        await dbClient.execute({
          sql: `UPDATE price_orders 
                SET status = 'cancelled', updated_at = ?
                WHERE symbol = ? AND side = ? AND status = 'active'`,
          args: [timestamp, symbol, side]
        });

        // 插入交易记录
        await dbClient.execute({
          sql: `INSERT INTO trades 
                (order_id, symbol, side, type, price, quantity, leverage, pnl, fee, timestamp, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            exchange_order_id, symbol, side, 'close',
            exitPrice, quantity, leverage, netPnl, totalFee, timestamp, 'filled'
          ]
        });

        // 插入平仓事件
        await dbClient.execute({
          sql: `INSERT INTO position_close_events 
                (symbol, side, entry_price, close_price, quantity, leverage,
                 pnl, pnl_percent, fee, close_reason, trigger_type, order_id,
                 created_at, processed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            symbol, side, entryPrice, exitPrice, quantity, leverage,
            netPnl, pnlPercent, totalFee, 'system_recovered', 'auto_fix',
            exchange_order_id, timestamp, 1
          ]
        });

        await dbClient.execute('COMMIT');
        logger.info(`✅ 已补充 ${symbol} 的平仓记录`);
        return true;

      } catch (dbError: any) {
        await dbClient.execute('ROLLBACK');
        logger.error('补充数据库记录失败:', dbError);
        return false;
      }

    } catch (error: any) {
      logger.error('修复平仓不一致失败:', error);
      return false;
    }
  }

  /**
   * 修复条件单触发不一致
   * 
   * 情况: 条件单在交易所触发，但数据库未更新
   * 策略: 与resolveClosePosition类似
   */
  private async resolvePriceOrderTriggered(state: any, exchangeClient: any): Promise<boolean> {
    // 复用 resolveClosePosition 的逻辑
    return await this.resolveClosePosition(state, exchangeClient);
  }

  /**
   * 修复「条件单触发但未找到成交记录」的不一致
   *
   * 背景：这类记录的 exchange_order_id 存的是条件单（算法单）的 id，条件单触发后
   * 交易所实际成交的是一笔**新的普通订单**，两者 id 不同。因此若直接复用
   * resolveClosePosition 按 id 匹配成交，必然匹配失败、永远返回 false，
   * 记录无法销账，健康检查会永久报「发现未解决的不一致状态」。
   *
   * 处理策略：
   * 1. 先确认交易所侧确实已无该持仓 —— 这是判断不一致是否仍然存在的唯一依据
   * 2. 在更宽的窗口内尽力回填成交明细（可能因订单号对不上而失败）
   * 3. 持仓确认已消失即销账：持仓层面状态已一致，遗留的只是历史成交明细缺失，
   *    不应让健康检查永久告警
   *
   * 注意：若交易所仍有该持仓，说明状态确实不一致，返回 false 交由人工处理。
   */
  private async resolvePriceOrderTriggeredNoTrade(state: any, exchangeClient: any): Promise<boolean> {
    const { symbol, side, exchange_order_id } = state;

    logger.info(`🔧 修复条件单触发无成交记录: ${symbol} ${side} (条件单=${exchange_order_id})`);

    const contract = exchangeClient.normalizeContract(symbol);
    const parseSize = (value: any): number => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };

    // 1. 交易所是否仍有该持仓
    const positions = await exchangeClient.getPositions();
    const stillOpen = positions.some(
      (p: any) => p.contract === contract && Math.abs(parseSize(p.size)) > 0
    );

    if (stillOpen) {
      logger.warn(`${symbol} 持仓仍存在于交易所，状态确实不一致，跳过自动销账`);
      return false;
    }

    // 2. 尽力回填成交明细
    try {
      const backfilled = await this.resolveClosePosition(state, exchangeClient);
      if (backfilled) {
        logger.info(`✅ 已回填 ${symbol} 的平仓成交明细`);
      } else {
        logger.warn(
          `${symbol} 无法回填成交明细（条件单号与触发后产生的订单号不同），` +
          `但交易所已无持仓，按状态一致销账`
        );
      }
    } catch (error: any) {
      logger.warn(`回填 ${symbol} 成交明细异常: ${error.message}，按持仓已平销账`);
    }

    // 3. 持仓确认已消失 -> 销账
    return true;
  }
}

// 导出单例
export const inconsistentStateResolver = new InconsistentStateResolver();
