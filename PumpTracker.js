const fs = require('fs');
const path = require('path');

class PumpTracker {
    constructor(filename = 'top_pumps.csv') {
        this.filename = filename;
        this.trackedPumps = new Map();
        this.ensureFileExists();
    }

    ensureFileExists() {
        if (!fs.existsSync(this.filename)) {
            fs.writeFileSync(this.filename, 'Address,Name,Peak Timestamp (UTC),Peak Rate 1m,Peak Rate 3m,Peak Rate 5m\n');
        }
    }

    formatTimestamp(date) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[date.getUTCMonth()];
        const day = date.getUTCDate().toString().padStart(2, '0');
        let hours = date.getUTCHours();
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        return `${month} ${day} ${hours}:${minutes}:${seconds} ${ampm} UTC`;
    }

    updatePump(address, name, rate1m, rate3m, rate5m) {
        const now = new Date();
        const formattedTimestamp = this.formatTimestamp(now);
        if (!this.trackedPumps.has(address)) {
            this.trackedPumps.set(address, {
                name,
                peakTimestamp: formattedTimestamp,
                peakRate1m: rate1m || 0,
                peakRate3m: rate3m || 0,
                peakRate5m: rate5m || 0
            });
            this.writeToFile(address, name, formattedTimestamp, rate1m || 0, rate3m || 0, rate5m || 0);
        } else {
            const pump = this.trackedPumps.get(address);
            let updated = false;
            if (rate1m > pump.peakRate1m) {
                pump.peakRate1m = rate1m;
                updated = true;
            }
            if (rate3m > pump.peakRate3m) {
                pump.peakRate3m = rate3m;
                updated = true;
            }
            if (rate5m > pump.peakRate5m) {
                pump.peakRate5m = rate5m;
                updated = true;
            }
            if (updated) {
                pump.peakTimestamp = formattedTimestamp;
                this.writeToFile(address, name, formattedTimestamp, pump.peakRate1m, pump.peakRate3m, pump.peakRate5m);
            }
        }
    }

    writeToFile(address, name, timestamp, rate1m, rate3m, rate5m) {
        const data = `${address},"${name}","${timestamp}",${rate1m},${rate3m},${rate5m}\n`;
        fs.appendFileSync(this.filename, data);
    }
}

module.exports = PumpTracker;