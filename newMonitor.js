const fetch = require('node-fetch');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const PumpTracker = require('./PumpTracker');
const pumpTracker = new PumpTracker();

let chalk;
try {
    chalk = require('chalk');
} catch (e) {
    chalk = {
        cyan: (text) => text,
        green: (text) => text,
        red: (text) => text,
    };
}

// Constants and Configuration
const url = 'https://webhook.site/token/(token id)/requests';
const apiKey = '';

// Global Variables
let coinStats = new Map();
let accountActivityTracker = new Map();
let processedIds = new Set();
let lastResetTime = Date.now();
let currentPage = 1;
let showRankingsOnly = false;
let lastTopPump1Min = null;
let flashInterval;

// Screen Setup
const screen = blessed.screen();

// Create tables
const table1Min = contrib.table({
    keys: true,
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'blue',
    interactive: true,
    label: 'Top Pumps (1 min)',
    width: '100%',
    height: '20%',
    border: { type: "line", fg: "cyan" },
    columnSpacing: 3,
    columnWidth: [48, 22, 10]
});

const notificationBox = blessed.box({
    top: '20%',
    left: 0,
    width: '100%',
    height: '5%',
    content: '',
    style: {
        fg: 'black',
        bg: 'white'
    },
    hidden: true
});

const table3Min = contrib.table({
    keys: true,
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'blue',
    interactive: true,
    label: 'Top Pumps (3 min)',
    top: '25%',
    width: '100%',
    height: '30%',
    border: { type: "line", fg: "cyan" },
    columnSpacing: 3,
    columnWidth: [48, 22, 10]
});

const table5Min = contrib.table({
    keys: true,
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'blue',
    interactive: true,
    label: 'Top Pumps (5 min)',
    top: '55%',
    width: '100%',
    height: '30%',
    border: { type: "line", fg: "cyan" },
    columnSpacing: 3,
    columnWidth: [48, 22, 10]
});

const logBox = blessed.log({
    parent: screen,
    label: 'Log',
    top: '85%',
    left: 0,
    width: '100%',
    height: '15%',
    border: { type: "line", fg: "cyan" },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
        ch: ' ',
        inverse: true
    }
});

screen.append(table1Min);
screen.append(notificationBox);
screen.append(table3Min);
screen.append(table5Min);
screen.append(logBox);

// Utility Functions
function isAccountSpamming(account) {
    const now = Date.now();
    const accountActivity = accountActivityTracker.get(account) || [];
    const recentActivity = accountActivity.filter(time => now - time < 60000);
    accountActivity.push(now);
    accountActivityTracker.set(account, recentActivity);
    return recentActivity.length > 15;
}

function extractTokenName(description) {
    const transferMatch = description.match(/transferred \d+(\.\d+)? (\w+) to/);
    if (transferMatch) return transferMatch[2];

    const mintMatch = description.match(/minted \d+(\.\d+)? (\w+) to/);
    if (mintMatch) return mintMatch[2];

    return null;
}

const knownTokenNames = new Map();

function getTokenName(mint, description) {
    if (knownTokenNames.has(mint)) return knownTokenNames.get(mint);
    const extractedName = extractTokenName(description);
    if (extractedName) {
        knownTokenNames.set(mint, extractedName);
        return extractedName;
    }
    return `Unknown${knownTokenNames.size + 1}`;
}

function updateCoinStats(transaction) {
    if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0 &&
        transaction.accountData && transaction.accountData.length > 0) {
        const account = transaction.accountData[0].account;
        if (isAccountSpamming(account)) {
            logBox.log(chalk.red(`Spam detected from account: ${account}`));
            return;
        }

        transaction.tokenTransfers.forEach(transfer => {
            const mint = transfer.mint;
            if (mint.toLowerCase().endsWith('pump')) {
                const now = Date.now();
                const tokenName = getTokenName(mint, transaction.description);
                const stats = coinStats.get(mint) || {
                    uniqueAccounts: new Set(),
                    name: tokenName,
                    firstInteractions: []
                };
                if (!stats.uniqueAccounts.has(account)) {
                    stats.uniqueAccounts.add(account);
                    stats.firstInteractions.push(now);
                    logBox.log(`New interaction: ${tokenName} (${mint}) - Account: ${account}`);
                }
                coinStats.set(mint, stats);

                if (!knownTokenNames.has(mint)) {
                    logBox.log(`New token discovered: ${tokenName} (${mint})`);
                }
            }
        });
    } else {
        logBox.log(chalk.red(`Invalid transaction structure: ${JSON.stringify(transaction)}`));
    }
}

async function fetchAllData(startPage = 1, maxPages = 15) {
    let page = startPage;
    let allData = [];
    let isLastPage = false;

    for (let i = 0; i < maxPages && !isLastPage; i++) {
        logBox.log(`Fetching page ${page}...`);
        try {
            const response = await fetch(`${url}?page=${page}&after=${lastResetTime}`, {
                headers: {
                    'Api-Key': apiKey,
                    'Accept': 'application/json',
                }
            });
            const data = await response.json();
            logBox.log(`Received ${data.data.length} items from page ${page}`);
            allData = allData.concat(data.data);
            isLastPage = data.is_last_page;
            page++;
        } catch (error) {
            logBox.log(chalk.red(`Error fetching page ${page}: ${error.message}`));
            break;
        }
    }

    logBox.log(`Total items received: ${allData.length}`);
    return { allData, nextPage: isLastPage ? null : page };
}

async function processData(allData) {
    let newTransactionsCount = 0;

    if (!Array.isArray(allData) || allData.length === 0) {
        logBox.log(chalk.red('No data to process or invalid data structure'));
        return;
    }

    for (const item of allData) {
        if (item && item.method === 'POST' && !processedIds.has(item.uuid) && new Date(item.created_at).getTime() >= lastResetTime) {
            try {
                const transactions = JSON.parse(item.content);
                logBox.log(`Processing ${transactions.length} transactions from item ${item.uuid}`);
                for (const t of transactions) {
                    updateCoinStats(t);
                    newTransactionsCount++;
                }
                processedIds.add(item.uuid);
            } catch (parseError) {
                logBox.log(chalk.red(`Error parsing transaction data: ${parseError.message}`));
                logBox.log(chalk.red(`Problematic content: ${item.content}`));
            }
        }
    }

    logBox.log(`Processed ${newTransactionsCount} new transactions`);
    logBox.log(`Total processed IDs: ${processedIds.size}`);
}

function calculateOccurrenceRate(occurrences, timeWindow) {
    const now = Date.now();
    const cutoffTime = now - timeWindow;
    const recentOccurrences = occurrences.filter(time => time >= cutoffTime);
    return recentOccurrences.length / (timeWindow / 60000); // Rate per minute
}

function showFlashingNotification(coin, rate) {
    notificationBox.setContent(`Alert: ${coin} pumping at rate ${rate}/min`);
    notificationBox.show();

    let isWhite = true;
    clearInterval(flashInterval);

    flashInterval = setInterval(() => {
        notificationBox.style.bg = isWhite ? 'red' : 'white';
        isWhite = !isWhite;
        screen.render();
    }, 500);

    setTimeout(() => {
        clearInterval(flashInterval);
        notificationBox.hide();
        screen.render();
    }, 15000);
}

function displayResults(rankingsOnly = false) {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const threeMinutesAgo = Date.now() - 3 * 60 * 1000;
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    logBox.log(`Calculating rankings... (1m: ${oneMinuteAgo}, 3m: ${threeMinutesAgo}, 5m: ${fiveMinutesAgo})`);

    const sortedCoins1min = Array.from(coinStats.entries())
        .map(([coin, stats]) => ({
            coin,
            name: stats.name,
            recentUniqueInteractions: stats.firstInteractions.filter(time => time >= oneMinuteAgo).length
        }))
        .sort((a, b) => b.recentUniqueInteractions - a.recentUniqueInteractions)
        .slice(0, 5);

    const sortedCoins3min = Array.from(coinStats.entries())
        .map(([coin, stats]) => ({
            coin,
            name: stats.name,
            recentUniqueInteractions: stats.firstInteractions.filter(time => time >= threeMinutesAgo).length
        }))
        .sort((a, b) => b.recentUniqueInteractions - a.recentUniqueInteractions)
        .slice(0, 25);

    const sortedCoins5min = Array.from(coinStats.entries())
        .map(([coin, stats]) => ({
            coin,
            name: stats.name,
            recentUniqueInteractions: stats.firstInteractions.filter(time => time >= fiveMinutesAgo).length
        }))
        .sort((a, b) => b.recentUniqueInteractions - a.recentUniqueInteractions)
        .slice(0, 25);

    logBox.log(`Rankings calculated. Top 1min: ${sortedCoins1min.length}, 3min: ${sortedCoins3min.length}, 5min: ${sortedCoins5min.length}`);

    // Update PumpTracker for all coins in top 5 of any ranking
    const topCoins = new Set([...sortedCoins1min, ...sortedCoins3min.slice(0, 5), ...sortedCoins5min.slice(0, 5)]);

    topCoins.forEach(coin => {
        const rate1m = sortedCoins1min.find(c => c.coin === coin.coin)?.recentUniqueInteractions || 0;
        const rate3m = sortedCoins3min.find(c => c.coin === coin.coin)?.recentUniqueInteractions || 0;
        const rate5m = sortedCoins5min.find(c => c.coin === coin.coin)?.recentUniqueInteractions || 0;

        pumpTracker.updatePump(coin.coin, coin.name, rate1m, rate3m, rate5m);
    });

    const data1min = sortedCoins1min.map((coin, index) => {
        const row = [
            `${(index + 1).toString().padEnd(2)}${chalk.cyan(coin.coin.padEnd(44))}`,
            coin.name.padEnd(20),
            coin.recentUniqueInteractions.toString().padStart(5)
        ];
        if (index === 0) {
            if (!lastTopPump1Min || lastTopPump1Min !== coin.coin) {
                row[0] = chalk.green(row[0]);
                lastTopPump1Min = coin.coin;
            }
        }

        // Check if rate is >= 5 and show notification
        if (coin.recentUniqueInteractions >= 5) {
            showFlashingNotification(coin.name, coin.recentUniqueInteractions);
        }

        return row;
    });

    const data3min = sortedCoins3min.map((coin, index) => [
        `${(index + 1).toString().padEnd(2)}${chalk.cyan(coin.coin.padEnd(44))}`,
        coin.name.padEnd(20),
        coin.recentUniqueInteractions.toString().padStart(5)
    ]);

    const data5min = sortedCoins5min.map((coin, index) => [
        `${(index + 1).toString().padEnd(2)}${chalk.cyan(coin.coin.padEnd(44))}`,
        coin.name.padEnd(20),
        coin.recentUniqueInteractions.toString().padStart(5)
    ]);

    table1Min.setData({
        headers: ['Coin (Address)', 'Name', 'Rate (1m)'],
        data: data1min
    });

    table3Min.setData({
        headers: ['Coin (Address)', 'Name', 'Rate (3m)'],
        data: data3min
    });

    table5Min.setData({
        headers: ['Coin (Address)', 'Name', 'Rate (5m)'],
        data: data5min
    });

    logBox.log('\nStatistics');
    logBox.log(`Total Unique "Pump" Coins: ${coinStats.size}`);

    const nextResetTime = new Date(lastResetTime + 2 * 60 * 60 * 1000);
    logBox.log(`Next memory reset: ${nextResetTime.toLocaleString()}`);

    const totalUniqueAccounts = new Set(
        Array.from(coinStats.values()).flatMap(stats => Array.from(stats.uniqueAccounts))
    ).size;
    logBox.log(`Total Unique Accounts: ${totalUniqueAccounts}`);

    logBox.log(`Tables updated. 1min: ${data1min.length}, 3min: ${data3min.length}, 5min: ${data5min.length}`);

    screen.render();
}

function cleanupOldData() {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    let totalRemoved = 0;
    for (const [coin, stats] of coinStats.entries()) {
        const originalLength = stats.firstInteractions.length;
        stats.firstInteractions = stats.firstInteractions.filter(time => time >= fiveMinutesAgo);
        totalRemoved += originalLength - stats.firstInteractions.length;
        if (stats.firstInteractions.length === 0) {
            coinStats.delete(coin);
        }
    }
    logBox.log(`Cleaned up old data. Removed ${totalRemoved} old interactions. Remaining coins: ${coinStats.size}`);
}

function resetRankings() {
    coinStats.clear();
    accountActivityTracker.clear();
    processedIds.clear();
    lastResetTime = Date.now();
    currentPage = 1;
    lastTopPump1Min = null;
    logBox.log('Rankings reset. Starting fresh...');
    displayResults();
    screen.render();
}

function formatTimeDifference(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

async function startScanning() {
    logBox.log('Starting scan cycle...');
    logBox.log('Press "c" to clear rankings and start fresh.');

    setInterval(async () => {
        logBox.log('\nStarting new scan cycle...');
        try {
            const { allData, nextPage } = await fetchAllData(currentPage);
            await processData(allData);
            cleanupOldData();
            displayResults(showRankingsOnly);

            currentPage = nextPage || 1;

            if (Date.now() - lastResetTime >= 2 * 60 * 60 * 1000) {
                resetRankings();
            }

            if (processedIds.size > 10000) {
                processedIds.clear();
                logBox.log("Cleared processed IDs cache");
            }

            logBox.log(`Current page: ${currentPage}`);
            logBox.log(`Time since last reset: ${formatTimeDifference(Date.now() - lastResetTime)}`);
            logBox.log(`Total unique coins tracked: ${coinStats.size}`);

            screen.render();
        } catch (error) {
            logBox.log(chalk.red(`Error in scan cycle: ${error.stack}`));
        }
    }, 15000);
}

// Event Handlers
screen.key(['escape', 'q', 'C-c'], function (ch, key) {
    clearInterval(flashInterval);
    return process.exit(0);
});

screen.key(['r'], function (ch, key) {
    showRankingsOnly = !showRankingsOnly;
    displayResults(showRankingsOnly);
});

screen.key(['c'], function (ch, key) {
    resetRankings();
});

screen.key(['up', 'down'], (ch, key) => {
    const focusedTable = screen.focused;
    if (focusedTable && focusedTable.move) {
        focusedTable.move(key.name);
        screen.render();
    }
});

screen.key(['tab'], () => {
    const tables = [table1Min, table3Min, table5Min];
    const currentIndex = tables.indexOf(screen.focused);
    const nextIndex = (currentIndex + 1) % tables.length;
    tables[nextIndex].focus();
    screen.render();
});

screen.key(['enter'], () => {
    const selectedTable = screen.focused;
    const selectedRow = selectedTable.rows.selected;
    if (selectedRow) {
        const coinInfo = selectedTable.rows.items[selectedRow].content.split('.')[1].trim();
        const [name, address] = coinInfo.match(/(.+) \((.+)\)/).slice(1);
        logBox.log(`Selected coin: ${name}`);
        logBox.log(`Full address: ${chalk.cyan(address)}`);
        screen.render();
    }
});

// Start the application
table1Min.focus();
startScanning();
screen.render();
