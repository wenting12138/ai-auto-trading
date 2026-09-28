#!/bin/bash

# ai-auto-trading - AI 加密货币自动交易系统
# Copyright (C) 2025 losesky
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
# 
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

# =====================================================
# 数据库状态查看脚本
# =====================================================

set -e

echo "=================================================="
echo "  数据库状态"
echo "=================================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 检查 .env 文件
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  未找到 .env 文件${NC}"
    exit 1
fi

source .env

DATABASE_URL=${DATABASE_URL:-"file:./.voltagent/trading.db"}

# 检查数据库文件
if [[ $DATABASE_URL == file:* ]]; then
    DB_FILE="${DATABASE_URL#file:}"
    
    if [ ! -f "$DB_FILE" ]; then
        echo -e "${YELLOW}⚠️  数据库文件不存在: $DB_FILE${NC}"
        echo ""
        echo "请运行以下命令初始化数据库:"
        echo -e "  ${BLUE}npm run db:init${NC}"
        exit 0
    fi
    
    echo -e "${GREEN}✅ 数据库文件: $DB_FILE${NC}"
    
    # 显示文件大小
    FILE_SIZE=$(du -h "$DB_FILE" | cut -f1)
    echo -e "${CYAN}📁 文件大小: $FILE_SIZE${NC}"
    
    # 显示修改时间
    MODIFIED=$(stat -c "%y" "$DB_FILE" 2>/dev/null | cut -d'.' -f1)
    echo -e "${CYAN}🕐 最后修改: $MODIFIED${NC}"
fi

echo ""
echo "=================================================="
echo "  数据库内容统计"
echo "=================================================="
echo ""

# 使用 Node.js 查询数据库
npx tsx --env-file=.env -e "
import { createClient } from '@libsql/client';
import Table from 'cli-table3';

const client = createClient({
  url: process.env.DATABASE_URL || 'file:./.voltagent/trading.db'
});

async function showStatus() {
  try {
    // 账户历史记录数
    const historyCount = await client.execute('SELECT COUNT(*) as count FROM account_history');
    console.log('📊 账户历史记录(account_history表):', (historyCount.rows[0] as any).count);
    
    // 最新账户状态
    const latestAccount = await client.execute('SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 1');
    if (latestAccount.rows.length > 0) {
      const acc = latestAccount.rows[0] as any;
      console.log('');
      console.log('💰 最新账户状态:');
      console.log('   总资产:', acc.total_value, 'USDT');
      console.log('   可用资金:', acc.available_cash, 'USDT');
      console.log('   未实现盈亏:', acc.unrealized_pnl, 'USDT');
      console.log('   总收益率:', acc.return_percent + '%');
      console.log('   更新时间:', new Date(acc.timestamp).toLocaleString('zh-CN'));
    }
    
    // 持仓数量
    const positionsCount = await client.execute('SELECT COUNT(*) as count FROM positions');
    console.log('');
    console.log('📈 当前持仓（positions表）:', (positionsCount.rows[0] as any).count);
    
    // 持仓详情
    const positions = await client.execute('SELECT * FROM positions');
    if (positions.rows.length > 0) {
      const posTable = new Table({
        head: ['币种', '数量', '方向', '入场价', '当前价', '清算价', '未实现盈亏', '杠杆', '止损价', '止盈价', '开仓时间'],
        style: { head: ['cyan'] }
      });
      
      positions.rows.forEach((pos: any) => {
        const pnl = parseFloat(pos.unrealized_pnl) >= 0 
          ? '+' + parseFloat(pos.unrealized_pnl).toFixed(2) 
          : parseFloat(pos.unrealized_pnl).toFixed(2);
        const openTime = new Date(pos.opened_at).toLocaleString('zh-CN', { hour12: false });
        posTable.push([
          pos.symbol,
          pos.quantity,
          pos.side,
          pos.entry_price,
          pos.current_price,
          pos.liquidation_price,
          pnl,
          pos.leverage + 'x',
          pos.stop_loss || '-',
          pos.profit_target || '-',
          openTime
        ]);
      });
      
      console.log(posTable.toString());
    } else {
      console.log('(无记录)');
    }
    
    // 交易记录数
    const tradesCount = await client.execute('SELECT COUNT(*) as count FROM trades');
    console.log('');
    console.log('📝 交易记录（trades表）:', (tradesCount.rows[0] as any).count);
    
    // 最近交易
    const recentTrades = await client.execute('SELECT * FROM trades ORDER BY timestamp DESC');
    if (recentTrades.rows.length > 0) {
      const tradeTable = new Table({
        head: ['订单ID', '币种', '方向', '类型', '价格', '数量', '杠杆', '盈亏', '手续费', '时间', '状态'],
        style: { head: ['cyan'] }
      });
      
      recentTrades.rows.forEach((trade: any) => {
        const pnl = trade.pnl 
          ? (parseFloat(trade.pnl) >= 0 ? '+' + parseFloat(trade.pnl).toFixed(2) : parseFloat(trade.pnl).toFixed(2))
          : '-';
        const fee = trade.fee ? parseFloat(trade.fee).toFixed(4) : '-';
        const time = new Date(trade.timestamp).toLocaleString('zh-CN', { hour12: false });
        tradeTable.push([
          String(trade.order_id).substring(0, 16),
          trade.symbol,
          trade.side,
          trade.type,
          trade.price,
          trade.quantity,
          trade.leverage + 'x',
          pnl,
          fee,
          time,
          trade.status
        ]);
      });
      
      console.log(tradeTable.toString());
    } else {
      console.log('(无记录)');
    }
        
    // 条件单（止损止盈订单）记录数
    const priceOrdersCount = await client.execute('SELECT COUNT(*) as count FROM price_orders');
    console.log('');
    console.log('📋 条件单记录（price_orders）:', (priceOrdersCount.rows[0] as any).count);

    // 条件单（止损止盈订单）最近50条
    const recentPriceOrders = await client.execute('SELECT * FROM price_orders ORDER BY created_at DESC');
    if (recentPriceOrders.rows.length > 0) {
      const orderTable = new Table({
        head: ['订单ID', '币种', '方向', '类型', '触发价', '订单价', '数量', '状态', '关联持仓ID', '创建时间', '更新时间'],
        style: { head: ['cyan'] }
      });
      
      recentPriceOrders.rows.forEach((order: any) => {
        const typeLabel = order.type === 'stop_loss' ? '止损' : order.type === 'take_profit' ? '止盈' : order.type || '-';
        const createdTime = new Date(order.created_at).toLocaleString('zh-CN', { hour12: false });
        const updatedTime = order.updated_at ? new Date(order.updated_at).toLocaleString('zh-CN', { hour12: false }) : '-';
        orderTable.push([
          String(order.order_id).substring(0, 16),
          order.symbol,
          order.side,
          typeLabel,
          order.trigger_price,
          order.order_price || '-',
          order.quantity,
          order.status,
          String(order.position_order_id || '-').substring(0, 16),
          createdTime,
          updatedTime
        ]);
      });
      
      console.log(orderTable.toString());
    } else {
      console.log('(无记录)');
    }
    
    // 活跃的条件单
    const activePriceOrders = await client.execute(\"SELECT * FROM price_orders WHERE status='active' ORDER BY created_at DESC\");
    if (activePriceOrders.rows.length > 0) {
      console.log('');
      console.log('活跃条件单（price_orders表,status=\'active\'）:');

      const activeTable = new Table({
        head: ['订单ID', '币种', '类型', '触发价', '创建时间'],
        style: { head: ['cyan'] }
      });
      
      activePriceOrders.rows.forEach((order: any) => {
        const typeLabel = order.type === 'stop_loss' ? '止损' : order.type === 'take_profit' ? '止盈' : order.type || '-';
        const createdTime = new Date(order.created_at).toLocaleString('zh-CN', { hour12: false });
        activeTable.push([
          String(order.order_id).substring(0, 16),
          order.symbol,
          typeLabel,
          order.trigger_price,
          createdTime
        ]);
      });
      
      console.log(activeTable.toString());
    }
    
    // 平仓事件记录数
    const closeEventsCount = await client.execute('SELECT COUNT(*) as count FROM position_close_events');
    console.log('');
    console.log('🔔 平仓事件记录（position_close_events表）:', (closeEventsCount.rows[0] as any).count);
    
    // 最近的平仓事件
    const recentCloseEvents = await client.execute('SELECT * FROM position_close_events ORDER BY created_at DESC');
    if (recentCloseEvents.rows.length > 0) {
      const closeTable = new Table({
        head: ['币种', '方向', '持仓ID', '入场价', '平仓价', '数量', '杠杆', '盈亏', '盈亏%', '手续费', '平仓原因', '触发类型', '订单ID', '创建时间', '已处理'],
        style: { head: ['cyan'] }
      });
      
      recentCloseEvents.rows.forEach((event: any) => {
        const reasonMap: Record<string, string> = {
          'stop_loss_triggered': '止损触发',
          'take_profit_triggered': '止盈触发',
          'manual_close': 'AI手动',
          'ai_decision': 'AI主动',
          'trend_reversal': '趋势反转',
          'forced_close': '系统强制',
          'partial_close': '分批止盈',
          'peak_drawdown': '峰值回撤',
          'time_limit': '持仓到期'
        };
        const reasonLabel = reasonMap[event.close_reason] || event.close_reason || '-';
        const triggerMap = {
          'ai_decision': 'AI决策',
          'manual_operation': '人工操作',
          'exchange_order': '交易所单',
          'price_order': '条件单',
          'system_risk': '系统风控',
          'auto_fix': '自动修复'
        };
        const triggerLabel = triggerMap[event.trigger_type] || event.trigger_type || '-';
        const pnlSign = parseFloat(event.pnl) >= 0 ? '+' : '';
        const pnl = pnlSign + parseFloat(event.pnl).toFixed(2);
        const pnlPercent = pnlSign + parseFloat(event.pnl_percent).toFixed(2) + '%';
        const fee = event.fee ? parseFloat(event.fee).toFixed(4) : '-';
        const processed = event.processed ? '是' : '否';
        const time = new Date(event.created_at).toLocaleString('zh-CN', { hour12: false });
        const positionId = event.position_order_id ? event.position_order_id.substring(0, 8) + '...' : '-';
        closeTable.push([
          event.symbol,
          event.side,
          positionId,
          event.entry_price,
          event.close_price,
          event.quantity,
          event.leverage + 'x',
          pnl,
          pnlPercent,
          fee,
          reasonLabel,
          triggerLabel,
          String(event.order_id || '-').substring(0, 16),
          time,
          processed
        ]);
      });
      
      console.log(closeTable.toString());
    } else {
      console.log('(无记录)');
    }
    
    // 分批止盈历史记录
    const partialTPCount = await client.execute('SELECT COUNT(*) as count FROM partial_take_profit_history');
    console.log('');
    console.log('🎯 分批止盈记录（partial_take_profit_history表）:', (partialTPCount.rows[0] as any).count);
    
    // 最近的分批止盈记录
    const recentPartialTP = await client.execute('SELECT * FROM partial_take_profit_history ORDER BY timestamp DESC');    
    if (recentPartialTP.rows.length > 0) {
      const tpTable = new Table({
        head: ['币种', '方向', '阶段', 'R倍数', '触发价', '平仓%', '平仓数量', '盈亏', '平仓订单ID', '持仓订单ID', '时间'],
        style: { head: ['cyan'] }
      });
      
      recentPartialTP.rows.forEach((tp: any) => {
        const time = new Date(tp.timestamp).toLocaleString('zh-CN', { hour12: false });
        const rMultiple = 'R=' + parseFloat(tp.r_multiple).toFixed(2);
        const stage = tp.stage;
        
        // Stage3 特殊处理：不执行平仓，只启用移动止损
        if (stage === 3) {
          const closePercent = '移动止损';
          const closedQty = '-';
          const pnl = '-';
          const orderId = '(无订单)';
          const positionOrderId = String(tp.position_order_id || '-').substring(0, 12);
          tpTable.push([
            tp.symbol,
            tp.side,
            'Stage' + stage,
            rMultiple,
            tp.trigger_price,
            closePercent,
            closedQty,
            pnl,
            orderId,
            positionOrderId,
            time
          ]);
        } else {
          // Stage1 和 Stage2：正常显示平仓数据
          const closePercent = parseFloat(tp.close_percent).toFixed(0) + '%';
          const pnlValue = parseFloat(tp.pnl);
          const pnl = pnlValue >= 0 ? '+' + pnlValue.toFixed(2) : pnlValue.toFixed(2);
          const closedQty = tp.closed_quantity ? parseFloat(tp.closed_quantity).toFixed(2) : '-';
          const orderId = String(tp.order_id || '-').substring(0, 12);
          const positionOrderId = String(tp.position_order_id || '-').substring(0, 12);
          tpTable.push([
            tp.symbol,
            tp.side,
            'Stage' + stage,
            rMultiple,
            tp.trigger_price,
            closePercent,
            closedQty,
            pnl,
            orderId,
            positionOrderId,
            time
          ]);
        }
      });
      
      console.log(tpTable.toString());
    } else {
      console.log('(无记录)');
    }
    
    // 数据不一致状态记录
    const inconsistentCount = await client.execute('SELECT COUNT(*) as count FROM inconsistent_states');
    console.log('');
    console.log('⚠️  数据不一致状态（inconsistent_states表）:', (inconsistentCount.rows[0] as any).count);
    
    // 最近的不一致状态记录
    const recentInconsistent = await client.execute('SELECT * FROM inconsistent_states ORDER BY created_at DESC');
    if (recentInconsistent.rows.length > 0) {
      const inconsistentTable = new Table({
        head: ['ID', '操作类型', '币种', '方向', '交易所', 'DB', '订单ID', '创建时间', '已解决'],
        style: { head: ['yellow'] },
        colWidths: [6, 28, 10, 8, 8, 6, 18, 20, 8]
      });
      
      recentInconsistent.rows.forEach((item: any) => {
        const time = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
        const exchangeStatus = item.exchange_success ? '✓' : '✗';
        const dbStatus = item.db_success ? '✓' : '✗';
        const resolved = item.resolved ? '是' : '否';
        const orderId = String(item.exchange_order_id || '-').substring(0, 16);
        
        inconsistentTable.push([
          item.id,
          item.operation,
          item.symbol,
          item.side,
          exchangeStatus,
          dbStatus,
          orderId,
          time,
          resolved
        ]);
      });
      
      console.log(inconsistentTable.toString());
      
      // 显示详细错误信息
      console.log('');
      console.log('📋 详细错误信息:');
      recentInconsistent.rows.forEach((item: any) => {
        console.log('');
        console.log(\`  [ID: \${item.id}] \${item.operation}\`);
        console.log(\`  ├─ 币种: \${item.symbol} (\${item.side})\`);
        console.log(\`  ├─ 订单ID: \${item.exchange_order_id || '-'}\`);
        console.log(\`  ├─ 时间: \${new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}\`);
        console.log(\`  ├─ 状态: 交易所=\${item.exchange_success ? '成功' : '失败'}, 数据库=\${item.db_success ? '成功' : '失败'}\`);
        console.log(\`  ├─ 已解决: \${item.resolved ? '是' : '否'}\`);
        console.log(\`  └─ 错误: \${item.error_message || '-'}\`);
      });
    } else {
      console.log('(无记录)');
    }

    
    // Agent 决策记录数
    const decisionsCount = await client.execute('SELECT COUNT(*) as count FROM agent_decisions');
    console.log('');
    console.log('🤖 AI 决策记录数:', (decisionsCount.rows[0] as any).count);
    
    // 最新决策
    const latestDecision = await client.execute('SELECT * FROM agent_decisions ORDER BY timestamp DESC LIMIT 1');
    if (latestDecision.rows.length > 0) {
      const dec = latestDecision.rows[0] as any;
      console.log('');
      console.log('最新 AI 决策:');
      console.log('   时间:', new Date(dec.timestamp).toLocaleString('zh-CN'));
      console.log('   迭代次数:', dec.iteration);
      console.log('   账户价值:', dec.account_value, 'USDT');
      console.log('   持仓数:', dec.positions_count);
    }
    
    client.close();
  } catch (error) {
    console.error('❌ 查询失败:', error);
    process.exit(1);
  }
}

showStatus();
"

echo ""
echo "=================================================="
echo ""
