/**
 * ai-auto-trading - AI 加密货币自动交易系统
 * Copyright (C) 2025 losesky
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// AI Trading Monitor - 使用真实 API
class TradingMonitor {
    constructor() {
        this.cryptoPrices = new Map();
        this.accountData = null;
        this.equityChart = null;
        this.chartTimeframe = '24'; // 固定24小时
        this.init();
    }

    async init() {
        await this.loadInitialData();
        this.initEquityChart();
        this.startDataUpdates();
        this.initTabs();
        this.initChat();
        this.duplicateTicker();
        this.loadGitHubStars(); // 加载 GitHub 星标数
        this.initDecisionNavigation(); // 初始化决策导航
        this.initPositionActions(); // 初始化持仓「平仓」按钮
    }

    // 加载初始数据
    async loadInitialData() {
        try {
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData(),
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadTickerPrices(),
                this.loadTradingStats()
            ]);
        } catch (error) {
            console.error('加载初始数据失败:', error);
        }
    }

    // 加载 GitHub 星标数
    async loadGitHubStars() {
        try {
            const response = await fetch('https://api.github.com/repos/losesky/ai-auto-trading');
            const data = await response.json();
            const starsCount = document.getElementById('stars-count');
            if (starsCount && data.stargazers_count !== undefined) {
                // 格式化星标数（超过1000显示 k）
                const count = data.stargazers_count;
                starsCount.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count;
            }
        } catch (error) {
            console.error('加载 GitHub 星标数失败:', error);
            const starsCount = document.getElementById('stars-count');
            if (starsCount) {
                starsCount.textContent = '-';
            }
        }
    }

    // 加载账户数据
    async loadAccountData() {
        try {
            const response = await fetch('/api/account');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            this.accountData = data;
            
            // 使用和 app.js 相同的算法计算总资产
            // API 返回的 totalBalance 不包含未实现盈亏
            // 显示的总资产需要加上未实现盈亏，以便实时反映持仓盈亏
            const totalBalanceWithPnl = data.totalBalance + data.unrealisedPnl;
            
            // 更新总资产
            const accountValueEl = document.getElementById('account-value');
            if (accountValueEl) {
                accountValueEl.textContent = formatUSDT(totalBalanceWithPnl);
            }

            // 计算总盈亏和盈亏比例
            const totalPnl = totalBalanceWithPnl - data.initialBalance;
            const pnlPercent = (totalPnl / data.initialBalance) * 100;
            const isProfit = totalPnl >= 0;
            
            // 更新总盈亏
            const balancePnlEl = document.getElementById('balance-pnl');
            if (balancePnlEl) {
                balancePnlEl.textContent = `${isProfit ? '+' : ''}${formatUSDT(totalPnl)}`;
                balancePnlEl.className = 'balance-pnl ' + (isProfit ? 'positive' : 'negative');
            }
            
            // 更新盈亏比例
            const balancePercentEl = document.getElementById('balance-percent');
            if (balancePercentEl) {
                balancePercentEl.textContent = `(${isProfit ? '+' : ''}${formatPercent(pnlPercent)}%)`;
                balancePercentEl.className = 'balance-percent ' + (isProfit ? 'positive' : 'negative');
            }

            // 更新可用余额
            const availableBalanceEl = document.getElementById('available-balance');
            if (availableBalanceEl) {
                availableBalanceEl.textContent = `${formatUSDT(data.availableBalance)} USDT`;
            }

            // 更新未实现盈亏（带符号和颜色）
            const unrealisedPnlEl = document.getElementById('unrealised-pnl');
            if (unrealisedPnlEl) {
                const pnlValue = (data.unrealisedPnl >= 0 ? '+' : '') + formatUSDT(data.unrealisedPnl);
                unrealisedPnlEl.textContent = `${pnlValue} USDT`;
                unrealisedPnlEl.className = 'metric-value ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
            }

            // 计算保证金比率
            // 保证金比率 = (已用保证金 / 总资产) * 100
            // 已用保证金 = 总资产 - 可用余额
            const usedMargin = totalBalanceWithPnl - data.availableBalance;
            const marginRatio = totalBalanceWithPnl > 0 ? (usedMargin / totalBalanceWithPnl) * 100 : 0;
            
            const marginRatioEl = document.getElementById('margin-ratio');
            if (marginRatioEl) {
                marginRatioEl.textContent = `${formatPercent(marginRatio)}%`;
                // 根据保证金比率设置颜色
                if (marginRatio < 50) {
                    marginRatioEl.className = 'metric-value';
                } else if (marginRatio < 180) {
                    marginRatioEl.className = 'metric-value';
                } else {
                    marginRatioEl.className = 'metric-value negative';
                }
            }

            // 更新风险状态
            this.updateRiskStatus(marginRatio);
            
        } catch (error) {
            console.error('加载账户数据失败:', error);
        }
    }

    // 加载持仓数据
    async loadPositionsData() {
        try {
            const response = await fetch('/api/positions');
            const data = await response.json();
            
            const positionsBody = document.getElementById('positions-body');
            const positionsCardsContainer = document.getElementById('positions-cards-container');
            
            // 更新 "当前持仓" 标签显示数量
            const positionsTabButton = document.querySelector('.tab-button[data-tab="positions"]');
            if (positionsTabButton) {
                const count = data.count || data.positions?.length || 0;
                positionsTabButton.textContent = `当前持仓(${count})`;
            }
            
            if (!data.positions || data.positions.length === 0) {
                // 更新表格
                if (positionsBody) {
                    positionsBody.innerHTML = '<tr><td colspan="9" class="empty-state">暂无持仓</td></tr>';
                }
                // 更新小卡片
                if (positionsCardsContainer) {
                    positionsCardsContainer.innerHTML = '<div class="positions-cards-empty">暂无持仓</div>';
                }
                return;
            }

            // 更新加密货币价格
            data.positions.forEach(pos => {
                this.cryptoPrices.set(pos.symbol, pos.currentPrice);
            });
            this.updateTickerPrices();

            // 更新持仓表格
            if (positionsBody) {
                positionsBody.innerHTML = data.positions.map(pos => {
                    // 🔧 使用实时价格（优先从cryptoPrices缓存获取，否则使用API返回的价格）
                    const currentPrice = this.cryptoPrices.get(pos.symbol) || pos.currentPrice;
                    
                    // 🔧 重新计算盈亏（使用实时价格）
                    let unrealizedPnl = pos.unrealizedPnl;
                    if (this.cryptoPrices.has(pos.symbol)) {
                        const priceDiff = pos.side === 'long' 
                            ? (currentPrice - pos.entryPrice)
                            : (pos.entryPrice - currentPrice);
                        unrealizedPnl = priceDiff * pos.quantity;
                    }
                    
                    // 🔧 收益率计算，带除零保护
                    const profitPercent = pos.openValue > 0 
                        ? ((unrealizedPnl / pos.openValue) * 100) 
                        : 0;
                    
                    // 方向显示 - 与交易历史统一样式
                    const sideText = pos.side === 'long' ? 'LONG' : 'SHORT';
                    const sideClass = pos.side === 'long' ? 'long' : 'short';
                    const leverage = pos.leverage || '-';
                    
                    // 盈亏显示
                    const pnlClass = unrealizedPnl >= 0 ? 'profit' : 'loss';
                    const pnlText = unrealizedPnl >= 0 ? `+$${formatUSDT(unrealizedPnl)}` : `-$${formatUSDT(Math.abs(unrealizedPnl))}`;
                    
                    return `
                        <tr>
                            <td><span class="symbol">${pos.symbol}</span></td>
                            <td><span class="side ${sideClass}">${sideText}</span></td>
                            <td>${leverage}x</td>
                            <td>$${formatPriceBySymbol(pos.symbol, pos.entryPrice)}</td>
                            <td>$${formatUSDT(pos.openValue)}</td>
                            <td>$${formatPriceBySymbol(pos.symbol, currentPrice)}</td>
                            <td><span class="${pnlClass}">${pnlText}</span></td>
                            <td class="${pnlClass}">
                                ${unrealizedPnl >= 0 ? '+' : ''}${formatPercent(profitPercent)}%
                            </td>
                            <td>
                                <button class="close-position-btn" data-symbol="${pos.symbol}" title="以市价平掉 ${pos.symbol} 全部持仓">平仓</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            // 更新持仓小卡片
            if (positionsCardsContainer) {
                positionsCardsContainer.innerHTML = data.positions.map(pos => {
                    // 🔧 使用实时价格（优先从cryptoPrices缓存获取，否则使用API返回的价格）
                    const currentPrice = this.cryptoPrices.get(pos.symbol) || pos.currentPrice;
                    
                    // 🔧 重新计算盈亏（使用实时价格）
                    let unrealizedPnl = pos.unrealizedPnl;
                    if (this.cryptoPrices.has(pos.symbol)) {
                        const priceDiff = pos.side === 'long' 
                            ? (currentPrice - pos.entryPrice)
                            : (pos.entryPrice - currentPrice);
                        unrealizedPnl = priceDiff * pos.quantity;
                    }
                    
                    // 🔧 收益率计算，带除零保护
                    const profitPercent = pos.openValue > 0 
                        ? ((unrealizedPnl / pos.openValue) * 100) 
                        : 0;
                    const sideClass = pos.side;
                    const sideText = pos.side === 'long' ? '多' : '空';
                    const pnlClass = unrealizedPnl >= 0 ? 'positive' : 'negative';
                    const leverage = pos.leverage || '-';
                    
                    return `
                        <div class="position-card ${sideClass} ${pnlClass}">
                            <span class="position-card-symbol">${pos.symbol} ${leverage}x</span>
                            <span class="position-card-pnl ${pnlClass}">
                                ${sideText} ${unrealizedPnl >= 0 ? '+' : ''}$${formatUSDT(unrealizedPnl)} (${unrealizedPnl >= 0 ? '+' : ''}${formatPercent(profitPercent)}%)
                            </span>
                        </div>
                    `;
                }).join('');
            }
            
        } catch (error) {
            console.error('加载持仓数据失败:', error);
        }
    }

    // 绑定持仓表格的「平仓」按钮
    // 使用事件委托：表格行每次轮询都会被 innerHTML 重建，直接绑定会丢失
    initPositionActions() {
        const positionsBody = document.getElementById('positions-body');
        if (!positionsBody || positionsBody.dataset.closeBound === 'true') {
            return;
        }
        positionsBody.dataset.closeBound = 'true';
        positionsBody.addEventListener('click', (event) => {
            const btn = event.target.closest('.close-position-btn');
            if (!btn) return;
            this.handleClosePosition(btn);
        });
    }

    // 人工手动平仓
    async handleClosePosition(btn) {
        const symbol = btn.dataset.symbol;
        if (!symbol) return;

        const confirmed = confirm(
            `确定要以市价平掉 ${symbol} 的全部持仓吗？\n\n` +
            `该操作立即以当前市场价格成交，不可撤销。`
        );
        if (!confirmed) return;

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '平仓中...';

        try {
            const response = await fetch(
                `/api/positions/${encodeURIComponent(symbol)}/close`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' } }
            );
            const data = await response.json();

            if (response.ok && data.success) {
                btn.textContent = '已平仓';
                // 立即刷新，并在稍后补刷一次（交易所持仓状态有延迟）
                await Promise.all([this.loadPositionsData(), this.loadAccountData()]);
                setTimeout(() => this.loadPositionsData(), 3000);
                return;
            }

            alert(`平仓 ${symbol} 失败：\n${data.error || data.message || '未知错误'}`);
        } catch (error) {
            alert(`平仓 ${symbol} 请求失败：${error.message}`);
        }

        btn.disabled = false;
        btn.textContent = originalText;
    }

    // 加载条件单数据（止盈止损）- 只显示活跃的条件单
    async loadPriceOrdersData() {
        try {
            const response = await fetch('/api/price-orders');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }
            
            // 更新 "止盈止损" 标签显示活跃持仓数量（每个持仓有止损+止盈）
            const priceOrdersTabButton = document.querySelector('.tab-button[data-tab="price-orders"]');
            if (priceOrdersTabButton) {
                // 活跃订单数 / 2 = 活跃持仓数
                const activePositionCount = Math.floor((data.count || 0) / 2);
                priceOrdersTabButton.textContent = `止盈止损(${activePositionCount})`;
            }

            const priceOrdersBody = document.getElementById('price-orders-body');
            
            if (!data.priceOrders || data.priceOrders.length === 0) {
                if (priceOrdersBody) {
                    priceOrdersBody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无活跃条件单</td></tr>';
                }
                return;
            }

            // 按币种、方向和开仓订单ID分组，合并止损和止盈
            const groupedOrders = {};
            
            data.priceOrders.forEach(order => {
                // 使用 position_order_id 作为分组键（如果没有则使用时间戳兼容旧数据）
                const key = order.position_order_id 
                    ? `${order.symbol}_${order.side}_${order.position_order_id}`
                    : `${order.symbol}_${order.side}_${Math.floor(new Date(order.created_at).getTime() / 1000)}`;
                
                if (!groupedOrders[key]) {
                    groupedOrders[key] = {
                        symbol: order.symbol,
                        side: order.side,
                        quantity: order.quantity,
                        created_at: order.created_at,
                        stopLoss: null,
                        takeProfit: null
                    };
                }
                
                if (order.type === 'stop_loss') {
                    groupedOrders[key].stopLoss = order.trigger_price;
                } else if (order.type === 'take_profit') {
                    groupedOrders[key].takeProfit = order.trigger_price;
                }
            });

            // 渲染条件单表格
            if (priceOrdersBody) {
                const rows = Object.values(groupedOrders)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                    .map(group => {
                        // 方向显示
                        const sideText = group.side === 'long' ? 'LONG' : 'SHORT';
                        const sideClass = group.side === 'long' ? 'long' : 'short';
                        
                        // 时间格式化
                        const createdTime = new Date(group.created_at).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        
                        // 获取当前价格
                        const currentPrice = this.cryptoPrices.get(group.symbol);
                        const currentPriceText = currentPrice ? 
                            `$${formatPriceBySymbol(group.symbol, currentPrice)}` : '--';
                        
                        // 止损价格显示（带偏差百分比）
                        let stopLossText = '--';
                        if (group.stopLoss) {
                            if (currentPrice) {
                                const deviation = ((group.stopLoss - currentPrice) / currentPrice * 100);
                                const deviationText = deviation >= 0 ? `+${deviation.toFixed(2)}` : deviation.toFixed(2);
                                stopLossText = `$${formatPriceBySymbol(group.symbol, group.stopLoss)} <span class="deviation">(${deviationText}%)</span>`;
                            } else {
                                stopLossText = `$${formatPriceBySymbol(group.symbol, group.stopLoss)}`;
                            }
                        }
                        
                        // 止盈价格显示（带偏差百分比）
                        let takeProfitText = '--';
                        if (group.takeProfit) {
                            if (currentPrice) {
                                const deviation = ((group.takeProfit - currentPrice) / currentPrice * 100);
                                const deviationText = deviation >= 0 ? `+${deviation.toFixed(2)}` : deviation.toFixed(2);
                                takeProfitText = `$${formatPriceBySymbol(group.symbol, group.takeProfit)} <span class="deviation">(${deviationText}%)</span>`;
                            } else {
                                takeProfitText = `$${formatPriceBySymbol(group.symbol, group.takeProfit)}`;
                            }
                        }
                        
                        return `
                            <tr>
                                <td><span class="symbol">${group.symbol}</span></td>
                                <td><span class="side ${sideClass}">${sideText}</span></td>
                                <td><span class="stop-loss">${stopLossText}</span></td>
                                <td><span class="current-price">${currentPriceText}</span></td>
                                <td><span class="take-profit">${takeProfitText}</span></td>
                                <td>${group.quantity}</td>
                                <td><span class="order-status status-active">活跃</span></td>
                                <td>${createdTime}</td>
                            </tr>
                        `;
                    });
                
                priceOrdersBody.innerHTML = rows.join('');
            }
            
        } catch (error) {
            console.error('加载条件单数据失败:', error);
        }
    }

    // 加载交易记录
    async loadTradesData() {
        try {
            const response = await fetch('/api/completed-trades?limit=50');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const tradesBody = document.getElementById('trades-body');
            const countEl = document.getElementById('tradesCount');
            
            if (!data.trades || data.trades.length === 0) {
                if (tradesBody) {
                    tradesBody.innerHTML = '<tr><td colspan="11" class="empty-state">暂无交易记录</td></tr>';
                }
                if (countEl) {
                    countEl.textContent = '';
                }
                return;
            }
            
            if (countEl) {
                countEl.textContent = `(最近${data.trades.length}条)`;
            }
            
            if (tradesBody) {
                tradesBody.innerHTML = data.trades.map(trade => {
                    // 平仓时间
                    const closeDate = new Date(trade.closeTime);
                    const timeStr = `${String(closeDate.getMonth() + 1).padStart(2, '0')}/${String(closeDate.getDate()).padStart(2, '0')} ${String(closeDate.getHours()).padStart(2, '0')}:${String(closeDate.getMinutes()).padStart(2, '0')}`;
                    
                    // 方向显示
                    const sideText = trade.side === 'long' ? 'LONG' : 'SHORT';
                    const sideClass = trade.side === 'long' ? 'long' : 'short';
                    
                    // 数量显示 - 使用USDT格式化（保留4位小数）
                    const quantityText = formatUSDT(trade.quantity, 4);
                    
                    // 盈亏显示
                    const pnl = trade.pnl || 0;
                    const pnlClass = pnl >= 0 ? 'profit' : 'loss';
                    const pnlText = pnl >= 0 ? `+$${formatUSDT(pnl)}` : `-$${formatUSDT(Math.abs(pnl))}`;
                    
                    // 平仓原因显示 - 与后端 accountManagement.ts 保持一致的映射
                    let closeReasonText = '-';
                    let closeReasonClass = '';
                    if (trade.closeReason) {
                        const reasonMap = {
                            'stop_loss_triggered': { text: '止损触发', class: 'close-reason-sl' },
                            'take_profit_triggered': { text: '止盈触发', class: 'close-reason-tp' },
                            'manual_close': { text: 'AI手动', class: 'close-reason-manual' },
                            'ai_decision': { text: 'AI主动', class: 'close-reason-ai' },
                            'trend_reversal': { text: '趋势反转', class: 'close-reason-reversal' },
                            'forced_close': { text: '系统强制', class: 'close-reason-forced' },
                            'partial_close': { text: '分批止盈', class: 'close-reason-partial' },
                            'peak_drawdown': { text: '峰值回撤', class: 'close-reason-peak' },
                            'time_limit': { text: '持仓到期', class: 'close-reason-time' },
                        };
                        
                        const mapping = reasonMap[trade.closeReason];
                        if (mapping) {
                            closeReasonText = mapping.text;
                            closeReasonClass = mapping.class;
                        } else {
                            closeReasonText = trade.closeReason;
                            closeReasonClass = 'close-reason-other';
                        }
                    }
                    
                    return `
                        <tr>
                            <td>${timeStr}</td>
                            <td><span class="symbol">${trade.symbol}</span></td>
                            <td><span class="side ${sideClass}">${sideText}</span></td>
                            <td>${trade.leverage}x</td>
                            <td>$${formatPriceBySymbol(trade.symbol, trade.openPrice)}</td>
                            <td>$${formatPriceBySymbol(trade.symbol, trade.closePrice)}</td>
                            <td>${quantityText}</td>
                            <td>${trade.holdingTime}</td>
                            <td>$${formatUSDT(trade.totalFee)}</td>
                            <td><span class="${pnlClass}">${pnlText}</span></td>
                            <td><span class="close-reason ${closeReasonClass}">${closeReasonText}</span></td>
                        </tr>
                    `;
                }).join('');
            }
            
        } catch (error) {
            console.error('加载交易记录失败:', error);
        }
    }

    // 加载 AI 决策日志 - 显示最新一条完整内容
    async loadLogsData(offset = 0) {
        try {
            // 加载更多决策以支持导航（最新的50条）
            const response = await fetch('/api/logs?limit=50');
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return;
            }

            const decisionContent = document.getElementById('decision-content');
            const decisionMeta = document.getElementById('decision-meta');
            const prevBtn = document.getElementById('prevDecisionBtn');
            const nextBtn = document.getElementById('nextDecisionBtn');
            
            // 保存所有决策数据供导航使用
            this.allDecisions = data.logs || [];
            
            // 初始化或更新当前索引
            if (!this.hasOwnProperty('currentDecisionIndex')) {
                this.currentDecisionIndex = offset;
            }
            
            if (this.allDecisions.length > 0) {
                // 确保索引在有效范围内
                if (this.currentDecisionIndex >= this.allDecisions.length) {
                    this.currentDecisionIndex = this.allDecisions.length - 1;
                }
                if (this.currentDecisionIndex < 0) {
                    this.currentDecisionIndex = 0;
                }
                
                const log = this.allDecisions[this.currentDecisionIndex];
                
                // 更新决策元信息
                if (decisionMeta) {
                    const timestamp = new Date(log.timestamp).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });
                    
                    decisionMeta.innerHTML = `
                        <span class="decision-time">${timestamp}</span>
                    `;
                }
                
                // 更新决策详细内容
                if (decisionContent) {
                    const decision = log.decision || log.actionsTaken || '暂无决策内容';
                    // 使用 marked 库将 markdown 转换为 HTML
                    const htmlContent = marked.parse(decision);
                    
                    decisionContent.innerHTML = `<div class="decision-text markdown-content">${htmlContent}</div>`;
                }
                
                // 更新导航按钮状态
                if (prevBtn) {
                    prevBtn.disabled = this.currentDecisionIndex >= this.allDecisions.length - 1;
                }
                if (nextBtn) {
                    nextBtn.disabled = this.currentDecisionIndex <= 0;
                }
            } else {
                if (decisionContent) {
                    decisionContent.innerHTML = '<p class="no-data">暂无 AI 决策记录</p>';
                }
                if (decisionMeta) {
                    decisionMeta.innerHTML = '<span class="decision-time">无数据</span>';
                }
                if (prevBtn) prevBtn.disabled = true;
                if (nextBtn) nextBtn.disabled = true;
            }
            
        } catch (error) {
            console.error('加载日志失败:', error);
            const decisionContent = document.getElementById('decision-content');
            if (decisionContent) {
                decisionContent.innerHTML = `<p class="error">加载失败: ${error.message}</p>`;
            }
        }
    }
    
    // 查看上一条决策
    showPreviousDecision() {
        if (this.allDecisions && this.currentDecisionIndex < this.allDecisions.length - 1) {
            this.currentDecisionIndex++;
            this.updateDecisionDisplay();
        }
    }
    
    // 查看下一条决策
    showNextDecision() {
        if (this.allDecisions && this.currentDecisionIndex > 0) {
            this.currentDecisionIndex--;
            this.updateDecisionDisplay();
        }
    }
    
    // 更新决策显示（不重新加载数据）
    updateDecisionDisplay() {
        if (!this.allDecisions || this.allDecisions.length === 0) {
            return;
        }
        
        const decisionContent = document.getElementById('decision-content');
        const decisionMeta = document.getElementById('decision-meta');
        const prevBtn = document.getElementById('prevDecisionBtn');
        const nextBtn = document.getElementById('nextDecisionBtn');
        
        const log = this.allDecisions[this.currentDecisionIndex];
        
        // 更新决策元信息
        if (decisionMeta) {
            const timestamp = new Date(log.timestamp).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            decisionMeta.innerHTML = `
                <span class="decision-time">${timestamp}</span>
            `;
        }
        
        // 更新决策详细内容
        if (decisionContent) {
            const decision = log.decision || log.actionsTaken || '暂无决策内容';
            // 使用 marked 库将 markdown 转换为 HTML
            const htmlContent = marked.parse(decision);
            
            decisionContent.innerHTML = `<div class="decision-text markdown-content">${htmlContent}</div>`;
        }
        
        // 更新导航按钮状态
        if (prevBtn) {
            prevBtn.disabled = this.currentDecisionIndex >= this.allDecisions.length - 1;
        }
        if (nextBtn) {
            nextBtn.disabled = this.currentDecisionIndex <= 0;
        }
    }

    // 加载顶部 Ticker 价格（从 API 获取）
    async loadTickerPrices() {
        try {
            // 先获取交易品种列表
            const symbolsResponse = await fetch('/api/trading-symbols');
            const symbolsData = await symbolsResponse.json();
            
            if (symbolsData.error) {
                console.error('获取交易品种列表失败:', symbolsData.error);
                return;
            }
            
            const symbols = symbolsData.symbols;
            
            // 如果 ticker 为空，先创建 ticker 项
            const tickerContainer = document.getElementById('ticker');
            if (tickerContainer && tickerContainer.children.length === 0) {
                symbols.forEach(symbol => {
                    const tickerItem = document.createElement('div');
                    tickerItem.className = 'ticker-item';
                    tickerItem.innerHTML = `
                        <span class="crypto-name">${symbol}</span>
                        <span class="crypto-price" data-symbol="${symbol}">$0.00</span>
                    `;
                    tickerContainer.appendChild(tickerItem);
                });
                
                // 重新触发滚动效果
                this.duplicateTicker();
            }
            
            // 获取价格数据
            const pricesResponse = await fetch('/api/prices');
            const pricesData = await pricesResponse.json();
            
            if (pricesData.error) {
                console.error('获取价格失败:', pricesData.error);
                return;
            }
            
            // 更新价格缓存
            Object.entries(pricesData.prices).forEach(([symbol, price]) => {
                this.cryptoPrices.set(symbol, price);
            });
            
            // 更新显示
            this.updateTickerPrices();
        } catch (error) {
            console.error('加载 Ticker 价格失败:', error);
        }
    }

    // 更新价格滚动条
    updateTickerPrices() {
        this.cryptoPrices.forEach((price, symbol) => {
            const priceElements = document.querySelectorAll(`[data-symbol="${symbol}"]`);
            priceElements.forEach(el => {
                el.textContent = '$' + formatPriceBySymbol(symbol, price);
            });
        });
    }

    // 启动数据更新
    startDataUpdates() {
        // 每10秒更新价格和持仓数据（确保价格先更新）
        setInterval(async () => {
            // 先更新价格缓存
            await this.loadTickerPrices();
            // 再更新持仓和条件单（使用最新价格）
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData(),
                this.loadPriceOrdersData()
            ]);
        }, 10000);

        // 每10秒更新交易记录、日志和交易统计
        setInterval(async () => {
            await Promise.all([
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadTradingStats()
            ]);
        }, 10000);

        // 每10秒更新资产曲线图表
        setInterval(async () => {
            await this.updateEquityChart();
        }, 10000);

        // 每60秒更新系统健康状态
        this.updateHealthStatus();
        setInterval(async () => {
            await this.updateHealthStatus();
        }, 60000);
    }

    // 更新系统健康状态
    async updateHealthStatus() {
        try {
            const response = await fetch('/api/health');
            const data = await response.json();
            
            const healthIndicator = document.getElementById('health-indicator');
            const healthLight = document.getElementById('health-light');
            // const healthText = document.getElementById('health-text');
            
            // if (!healthIndicator || !healthLight || !healthText) {
            if (!healthIndicator || !healthLight) {
                return;
            }
            
            // 移除所有状态类
            healthIndicator.classList.remove('healthy', 'warning', 'error');
            healthLight.classList.remove('healthy', 'warning', 'error');
            
            // 优先检查熔断器状态（即使系统healthy，如果使用缓存也应显示黄色告警）
            if (data.circuitBreaker && data.circuitBreaker.isOpen) {
                healthIndicator.classList.add('warning');
                healthLight.classList.add('warning');
                const reason = data.circuitBreaker.reason || '未知原因';
                const remaining = data.circuitBreaker.remainingSeconds 
                    ? `，剩余 ${data.circuitBreaker.remainingSeconds} 秒` 
                    : '';
                healthIndicator.title = `⚠️ 使用缓存数据：${reason}${remaining}\n系统正在使用历史缓存数据，价格可能有延迟`;
            }
            // 根据健康检查结果设置状态
            else if (data.healthy) {
                healthIndicator.classList.add('healthy');
                healthLight.classList.add('healthy');
                // healthText.textContent = '系统正常';
                healthIndicator.title = '系统运行正常';
            } else if (data.issues && data.issues.length > 0) {
                healthIndicator.classList.add('error');
                healthLight.classList.add('error');
                // healthText.textContent = '系统异常';
                healthIndicator.title = `严重问题: ${data.issues.length}个\n${data.issues.join('\n')}`;
            } else if (data.warnings && data.warnings.length > 0) {
                healthIndicator.classList.add('warning');
                healthLight.classList.add('warning');
                // healthText.textContent = '系统警告';
                healthIndicator.title = `警告: ${data.warnings.length}个\n${data.warnings.join('\n')}`;
            } else {
                // healthText.textContent = '状态未知';
                healthIndicator.title = '无法获取系统状态';
            }
        } catch (error) {
            console.error('更新健康状态失败:', error);
            
            const healthIndicator = document.getElementById('health-indicator');
            const healthLight = document.getElementById('health-light');
            // const healthText = document.getElementById('health-text');
            
            // if (healthIndicator && healthLight && healthText) {
            if (healthIndicator && healthLight) {
                healthIndicator.classList.remove('healthy', 'warning');
                healthIndicator.classList.add('error');
                healthLight.classList.remove('healthy', 'warning');
                healthLight.classList.add('error');
                // healthText.textContent = '连接失败';
                healthIndicator.title = '无法连接到健康检查服务';
            }
        }
    }

    // 初始化选项卡（简化版，只有一个选项卡）
    initTabs() {
        // 初始化TAB切换功能
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // 移除所有active类
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // 添加active类到当前选中的tab
                button.classList.add('active');
                const targetContent = document.getElementById(`tab-${targetTab}`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
                
                // 如果切换到止盈止损tab，加载数据
                if (targetTab === 'price-orders') {
                    this.loadPriceOrdersData();
                }
            });
        });
    }

    // 复制ticker内容实现无缝滚动
    duplicateTicker() {
        const ticker = document.getElementById('ticker');
        if (ticker) {
            const tickerContent = ticker.innerHTML;
            ticker.innerHTML = tickerContent + tickerContent + tickerContent;
        }
    }

    // 初始化聊天功能（已移除）
    initChat() {
        // 聊天功能已移除
    }
    
    // 初始化决策导航
    initDecisionNavigation() {
        const prevBtn = document.getElementById('prevDecisionBtn');
        const nextBtn = document.getElementById('nextDecisionBtn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.showPreviousDecision();
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.showNextDecision();
            });
        }
    }
    
    // 初始化资产曲线图表
    async initEquityChart() {
        const ctx = document.getElementById('equityChart');
        if (!ctx) {
            console.error('未找到图表canvas元素');
            return;
        }

        // 加载历史数据
        const historyData = await this.loadEquityHistory();
        
        console.log('资产历史数据:', historyData);
        
        if (!historyData || historyData.length === 0) {
            console.log('暂无历史数据，图表将在有数据后显示');
            // 显示提示信息
            const container = ctx.parentElement;
            if (container) {
                const message = document.createElement('div');
                message.className = 'no-data';
                message.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #00cc88; text-align: center;';
                message.innerHTML = '暂无历史数据<br><small style="color: #008866;">系统将每5秒自动记录账户资产</small>';
                container.appendChild(message);
            }
            return;
        }

        // 创建图表
        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: historyData.map(d => {
                    const date = new Date(d.timestamp);
                    return date.toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }),
                datasets: [
                    {
                        label: '总资产 (USDT)',
                        data: historyData.map(d => parseFloat(d.totalValue.toFixed(2))),
                        borderColor: 'rgb(0, 255, 170)',
                        backgroundColor: 'rgba(0, 255, 170, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(17, 24, 39, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: 'rgb(59, 130, 246)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += '$' + context.parsed.y;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#9ca3af',
                            maxRotation: 45,
                            minRotation: 0,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#9ca3af',
                            callback: function(value) {
                                return '$' + formatUSDT(value);
                            }
                        }
                    }
                }
            }
        });
    }

    // 加载资产历史数据
    async loadEquityHistory() {
        try {
            // 获取全部历史数据
            const response = await fetch(`/api/history`);
            const data = await response.json();
            
            if (data.error) {
                console.error('API错误:', data.error);
                return [];
            }
            
            return data.history || [];
        } catch (error) {
            console.error('加载资产历史数据失败:', error);
            return [];
        }
    }

    // 更新资产曲线图表
    async updateEquityChart() {
        if (!this.equityChart) {
            await this.initEquityChart();
            return;
        }

        const historyData = await this.loadEquityHistory();
        
        if (!historyData || historyData.length === 0) {
            return;
        }

        // 更新图表数据
        this.equityChart.data.labels = historyData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        });
        
        this.equityChart.data.datasets[0].data = historyData.map(d => 
            parseFloat(formatUSDT(d.totalValue))
        );
        
        // 固定不显示圆点
        this.equityChart.data.datasets[0].pointRadius = 0;
        
        this.equityChart.update('none'); // 无动画更新
    }

    // 更新风险状态
    updateRiskStatus(marginRatio) {
        const riskStatusEl = document.querySelector('.risk-status');
        const statusLabelEl = document.querySelector('.status-label');
        const statusDescEl = document.getElementById('risk-status-desc');
        
        if (!riskStatusEl || !statusLabelEl || !statusDescEl) return;
        
        // 移除所有状态类
        riskStatusEl.classList.remove('safe', 'warning', 'danger');
        
        if (marginRatio < 50) {
            // 安全状态
            riskStatusEl.classList.add('safe');
            statusLabelEl.textContent = '风险状态：安全';
            statusDescEl.textContent = '保证金比率低于50%为安全，超过80%需警惕';
        } else if (marginRatio < 80) {
            // 警告状态
            riskStatusEl.classList.add('warning');
            statusLabelEl.textContent = '风险状态：警告';
            statusDescEl.textContent = '保证金比率在50%-80%之间，建议关注仓位';
        } else {
            // 危险状态
            riskStatusEl.classList.add('danger');
            statusLabelEl.textContent = '风险状态：危险';
            statusDescEl.textContent = '保证金比率超过80%，强烈建议降低仓位！';
        }
    }

    // 加载交易统计数据
    async loadTradingStats() {
        try {
            // 同时获取统计数据和交易历史（用于计算更多指标）
            const [statsResponse, tradesResponse, accountResponse] = await Promise.all([
                fetch('/api/stats'),
                fetch('/api/completed-trades?limit=1000'), // 获取所有交易用于详细分析
                fetch('/api/account')
            ]);
            
            const stats = await statsResponse.json();
            const trades = await tradesResponse.json();
            const account = await accountResponse.json();
            
            if (stats.error || trades.error || account.error) {
                console.error('API错误:', stats.error || trades.error || account.error);
                return;
            }
            
            // 基础统计
            this.updateStatValue('stat-win-rate', `${formatPercent(stats.winRate, 1)}%`);
            this.updateStatValue('stat-total-trades', stats.totalTrades);
            this.updateStatValue('stat-max-loss', this.formatPnl(stats.maxLoss));
            
            // 计算单笔平均盈亏
            const avgPnl = stats.totalTrades > 0 ? stats.totalPnl / stats.totalTrades : 0;
            this.updateStatValue('stat-avg-pnl', this.formatPnl(avgPnl));
            
            // 计算累计盈利和亏损
            let totalProfit = 0;
            let totalLoss = 0;
            let totalFee = 0;
            let totalLeverage = 0;
            let leverageCount = 0;
            let totalDurationSeconds = 0;
            const symbolCounts = {};
            const directionCounts = { long: 0, short: 0 };
            
            if (trades.trades && trades.trades.length > 0) {
                trades.trades.forEach(trade => {
                    if (trade.pnl > 0) {
                        totalProfit += trade.pnl;
                    } else if (trade.pnl < 0) {
                        totalLoss += Math.abs(trade.pnl);
                    }
                    
                    totalFee += trade.totalFee || 0;
                    
                    if (trade.leverage) {
                        totalLeverage += trade.leverage;
                        leverageCount++;
                    }
                    
                    // 统计持仓时长（将字符串转换为秒数）
                    if (trade.holdingTime) {
                        const duration = this.parseDuration(trade.holdingTime);
                        totalDurationSeconds += duration;
                    }
                    
                    // 统计交易对
                    symbolCounts[trade.symbol] = (symbolCounts[trade.symbol] || 0) + 1;
                    
                    // 统计方向
                    if (trade.side === 'long') {
                        directionCounts.long++;
                    } else if (trade.side === 'short') {
                        directionCounts.short++;
                    }
                });
            }
            
            this.updateStatValue('stat-total-profit', `+$${formatUSDT(totalProfit)}`);
            this.updateStatValue('stat-total-loss', `-$${formatUSDT(totalLoss)}`);
            this.updateStatValue('stat-total-fee', `$${formatUSDT(totalFee)}`);
            
            // 计算平均杠杆
            const avgLeverage = leverageCount > 0 ? totalLeverage / leverageCount : 0;
            this.updateStatValue('stat-avg-leverage', `${formatPercent(avgLeverage, 1)}x`);
            
            // 计算利润因子
            const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
            this.updateStatValue('stat-profit-factor', formatPercent(profitFactor));
            
            // 计算平均持仓时长
            const avgDuration = trades.trades.length > 0 ? totalDurationSeconds / trades.trades.length : 0;
            this.updateStatValue('stat-avg-duration', this.formatDuration(avgDuration));
            
            // 计算夏普比率（简化版）
            const sharpeRatio = this.calculateSharpe(trades.trades, account.initialBalance);
            this.updateStatValue('stat-sharpe', formatPercent(sharpeRatio));
            
            // 计算最大回撤
            const maxDrawdown = this.calculateMaxDrawdown(trades.trades, account.initialBalance);
            this.updateStatValue('stat-max-drawdown', `${formatPercent(maxDrawdown, 1)}%`);
            
            // 更新方向分布
            const totalTrades = directionCounts.long + directionCounts.short;
            const longPercent = totalTrades > 0 ? (directionCounts.long / totalTrades * 100) : 0;
            const shortPercent = totalTrades > 0 ? (directionCounts.short / totalTrades * 100) : 0;
            const neutralPercent = (100 - longPercent - shortPercent);
            
            document.getElementById('stat-long-percent').textContent = `${formatPercent(longPercent, 1)}%`;
            document.getElementById('stat-short-percent').textContent = `${formatPercent(shortPercent, 1)}%`;
            document.getElementById('stat-neutral-percent').textContent = `${formatPercent(neutralPercent, 1)}%`;
            
            // 计算 HHI（赫芬达尔-赫希曼指数）来衡量交易集中度
            // HHI = Σ(市场份额%)^2，范围0-10000
            // 0-1500: 低集中度（分散）
            // 1500-2500: 中等集中度
            // 2500+: 高集中度
            let hhi = 0;
            if (totalTrades > 0) {
                Object.values(symbolCounts).forEach(count => {
                    const marketShare = (count / totalTrades) * 100;
                    hhi += marketShare * marketShare;
                });
            }
            
            // 判断集中度级别
            let concentrationLevel = '';
            if (hhi < 1500) {
                concentrationLevel = '分散';
            } else if (hhi < 2500) {
                concentrationLevel = '中等';
            } else {
                concentrationLevel = '集中';
            }
            
            // 更新 HHI 标签
            const hhiLabelEl = document.getElementById('stat-hhi-label');
            if (hhiLabelEl) {
                hhiLabelEl.textContent = ` · HHI ${formatPercent(hhi / 100)} · ${concentrationLevel}`;
            }
            
            // 更新交易对偏好（TOP 5）
            const topPairs = Object.entries(symbolCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([symbol, count]) => {
                    const percent = totalTrades > 0 ? (count / totalTrades * 100) : 0;
                    return `${symbol} ${formatPercent(percent, 1)}%`;
                })
                .join('  ');
            
            this.updateStatValue('stat-top-pairs', topPairs || '暂无数据');
            
        } catch (error) {
            console.error('加载交易统计失败:', error);
        }
    }
    
    // 辅助方法：格式化盈亏显示
    formatPnl(value) {
        if (value >= 0) {
            return `+$${formatUSDT(value)}`;
        } else {
            return `-$${formatUSDT(Math.abs(value))}`;
        }
    }
    
    // 辅助方法：解析持仓时长字符串为秒数
    parseDuration(durationStr) {
        let seconds = 0;
        const dayMatch = durationStr.match(/(\d+)天/);
        const hourMatch = durationStr.match(/(\d+)(小时|时)/);
        const minMatch = durationStr.match(/(\d+)分/);
        
        if (dayMatch) seconds += parseInt(dayMatch[1]) * 86400;
        if (hourMatch) seconds += parseInt(hourMatch[1]) * 3600;
        if (minMatch) seconds += parseInt(minMatch[1]) * 60;
        
        return seconds;
    }
    
    // 辅助方法：格式化秒数为可读时长
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainHours = hours % 24;
            return `${days}天${remainHours}小时${minutes}分`;
        } else if (hours > 0) {
            return `${hours}小时${minutes}分`;
        } else {
            return `${minutes}分`;
        }
    }
    
    // 辅助方法：计算夏普比率
    calculateSharpe(trades, initialBalance) {
        if (!trades || trades.length < 2) return 0;
        
        // 计算每笔交易的收益率
        const returns = trades.map(t => (t.pnl || 0) / initialBalance);
        
        // 计算平均收益率
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        
        // 计算标准差
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        
        // 夏普比率 = 平均收益 / 标准差（假设无风险收益率为0）
        return stdDev > 0 ? avgReturn / stdDev : 0;
    }
    
    // 辅助方法：计算最大回撤
    calculateMaxDrawdown(trades, initialBalance) {
        if (!trades || trades.length === 0) return 0;
        
        let equity = initialBalance;
        let peak = initialBalance;
        let maxDrawdown = 0;
        
        // 按时间排序
        const sortedTrades = [...trades].sort((a, b) => 
            new Date(a.closeTime) - new Date(b.closeTime)
        );
        
        sortedTrades.forEach(trade => {
            equity += (trade.pnl || 0);
            
            if (equity > peak) {
                peak = equity;
            }
            
            const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        });
        
        return maxDrawdown;
    }
    
    // 辅助方法：更新统计值（带动画效果）
    updateStatValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const oldValue = element.textContent;
        const newValue = String(value); // 统一转换为字符串进行比较
        
        // 如果值没有变化，不更新
        if (oldValue === newValue) return;
        
        // 添加闪烁效果表示数据更新
        element.style.transition = 'background-color 0.3s ease';
        element.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
        
        // 更新数值
        element.textContent = newValue;
        
        // 根据值添加颜色类
        if (newValue.startsWith('+') && !newValue.includes('%')) {
            element.classList.add('positive');
            element.classList.remove('negative');
        } else if (newValue.startsWith('-')) {
            element.classList.add('negative');
            element.classList.remove('positive');
        }
        
        // 恢复背景色
        setTimeout(() => {
            element.style.backgroundColor = '';
        }, 300);
    }
}

// 初始化监控系统
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new TradingMonitor();
});
