const fs = require('fs');
const axios = require('axios');

const readAddressesFromFile = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const addresses = data.split('\n').map(addr => addr.trim()).filter(addr => addr.length > 0);
    return addresses;
  } catch (err) {
    console.error(`Error reading file from disk: ${err}`);
    return [];
  }
};

const createWebhook = async (addresses) => {
  const url = "https://api.helius.xyz/v0/webhooks?api-key=9a0a2acf-471e-4fc0-9ebd-0624001668c1";
  const payload = {
    webhookURL: `https://webhook.site/(input token id)`,
    transactionTypes: ["TRANSFER"],
    accountAddresses: addresses,
    webhookType: "enhanced",  // or "enhancedDevnet"
    authHeader: ""  // Optional, remove if not needed
  };
  const headers = {
    "Content-Type": "application/json"
  };

  try {
    const response = await axios.post(url, payload, { headers });
    console.log(response.data);
  } catch (error) {
    console.error(`Error: ${error}`);
  }
};

const addresses = readAddressesFromFile('wallets.txt');
createWebhook(addresses);
