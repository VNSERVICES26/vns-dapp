// सिर्फ Mainnet का कॉन्फिगरेशन
const CONFIG = {
    mainnet: {
        vnstSwapAddress: "0x8FD96c769308bCf01A1F5E9f93805c552fF80713", 
        vnstTokenAddress: "0xF9Bbb00436B384b57A52D1DfeA8Ca43fC7F11527", 
        usdtTokenAddress: "0x55d398326f99059fF775485246999027B3197955", 
        chainId: "0x38", // BSC Mainnet chain ID
        rpcUrl: "https://bsc-dataseed.binance.org/"
    }
};

let web3;
let swapContract;
let vnstToken;
let usdtToken;
let currentAccount = null;
let minBuyAmount = 0;
let vnstDecimals = 18; // VNST के 18 डेसीमल होते हैं

// पेज लोड होने पर ये फंक्शन चलेगा
window.addEventListener('load', async () => {
    await setupEventListeners();
    await checkWalletConnection();
    await initContracts();
    setupInputListener();
    updateUI();
});

// सारे इवेंट लिस्नर सेटअप करता है
async function setupEventListeners() {
    document.getElementById('connectWalletBtn').addEventListener('click', connectWallet);
    document.getElementById('approveBtn').addEventListener('click', approveUSDT);
    document.getElementById('buyBtn').addEventListener('click', buyVNST);
    document.getElementById('copyContractBtn').addEventListener('click', copyContractAddress);
}

// VNST एमाउंट इनपुट के लिए लिस्नर
function setupInputListener() {
    const vnstAmountInput = document.getElementById('vnstAmount');
    vnstAmountInput.addEventListener('input', async () => {
        if (currentAccount) {
            await calculateQuote();
        }
    });
}

// टोकन यूनिट्स में कन्वर्ट करता है
function toTokenUnits(amount, decimals = 18) {
    return web3.utils.toBN(amount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(decimals)));
}

// USDT की कीमत कैलकुलेट करता है
async function calculateQuote() {
    try {
        const vnstAmountInput = document.getElementById('vnstAmount').value;
        
        if (!vnstAmountInput || isNaN(vnstAmountInput)) {
            document.getElementById('quoteResult').classList.add('hidden');
            return;
        }
        
        const vnstAmount = toTokenUnits(vnstAmountInput);
        const minBuy = web3.utils.toBN(minBuyAmount);
        
        if (vnstAmount.lt(minBuy)) {
            document.getElementById('quoteResult').classList.add('hidden');
            return;
        }
        
        const usdtAmount = await swapContract.methods.getQuote(vnstAmount.toString()).call();
        const usdtDecimals = await usdtToken.methods.decimals().call();
        
        document.getElementById('usdtAmount').textContent = formatUnits(usdtAmount, usdtDecimals);
        document.getElementById('quoteResult').classList.remove('hidden');
        
        const isApproved = await checkApprovalStatus(vnstAmount.toString());
        document.getElementById('approveBtn').disabled = isApproved;
        document.getElementById('buyBtn').disabled = !isApproved;
        
    } catch (error) {
        console.error('कीमत कैलकुलेशन में त्रुटि:', error);
        document.getElementById('quoteResult').classList.add('hidden');
    }
}

// वॉलेट कनेक्शन चेक करता है
async function checkWalletConnection() {
    if (window.ethereum) {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                currentAccount = accounts[0];
                setupWalletEvents();
            }
        } catch (error) {
            console.error("वॉलेट कनेक्शन चेक करने में त्रुटि:", error);
        }
    }
}

// वॉलेट इवेंट्स सेटअप करता है
function setupWalletEvents() {
    if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
            currentAccount = accounts.length > 0 ? accounts[0] : null;
            updateUI();
            if (currentAccount) calculateQuote();
        });
        
        window.ethereum.on('chainChanged', () => {
            window.location.reload();
        });
        
        window.ethereum.on('disconnect', (error) => {
            console.log('वॉलेट डिस्कनेक्ट हुआ:', error);
            currentAccount = null;
            updateUI();
        });
    }
}

// वॉलेट कनेक्ट करता है
async function connectWallet() {
    if (!window.ethereum) {
        showMessage('कृपया MetaMask या कोई अन्य Web3 वॉलेट इंस्टॉल करें', 'error');
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        currentAccount = accounts[0];
        setupWalletEvents();
        
        const usdtDecimals = await usdtToken.methods.decimals().call();
        const balance = await usdtToken.methods.balanceOf(currentAccount).call();
        
        document.getElementById('walletAddress').textContent = shortenAddress(currentAccount);
        document.getElementById('usdtBalance').textContent = formatUnits(balance, usdtDecimals);
        document.getElementById('walletInfo').classList.remove('hidden');
        
        showMessage('वॉलेट सफलतापूर्वक कनेक्ट हो गया', 'success');
        updateUI();
        await calculateQuote();
    } catch (error) {
        if (error.code === 4001) {
            showMessage('यूजर ने कनेक्शन रिक्वेस्ट रिजेक्ट कर दी', 'error');
        } else {
            showMessage(`वॉलेट कनेक्ट करने में त्रुटि: ${error.message}`, 'error');
        }
    }
}

// कॉन्ट्रैक्ट्स इनिशियलाइज़ करता है
async function initContracts() {
    try {
        const config = CONFIG.mainnet;
        web3 = new Web3(window.ethereum || config.rpcUrl);
        
        // कॉन्ट्रैक्ट ABI और एड्रेस
        const swapABI = [{"inputs":[{"internalType":"address","name":"_vnstToken","type":"address"},{"internalType":"address","name":"_usdtToken","type":"address"},{"internalType":"address","name":"_sellerWallet","type":"address"},{"internalType":"address","name":"_usdtReceiver","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"buyer","type":"address"},{"indexed":false,"internalType":"uint256","name":"current","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"required","type":"uint256"}],"name":"BuyerAllowanceLow","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"newMinBuy","type":"uint256"}],"name":"MinBuyUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"newPrice","type":"uint256"}],"name":"PriceUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"newReceiver","type":"address"}],"name":"ReceiverUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"current","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"required","type":"uint256"}],"name":"SellerAllowanceLow","type":"event"},{"anonymous":false,"inputs":[],"name":"SwapPaused","type":"event"},{"anonymous":false,"inputs":[],"name":"SwapResumed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"buyer","type":"address"},{"indexed":false,"internalType":"uint256","name":"usdtAmount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"vnstAmount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"rateUsed","type":"uint256"}],"name":"TokensPurchased","type":"event"},{"stateMutability":"payable","type":"fallback"},{"inputs":[{"internalType":"uint256","name":"vnstAmount","type":"uint256"}],"name":"buyVNST","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"vnstAmount","type":"uint256"}],"name":"calculateUsdtRequired","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"buyer","type":"address"}],"name":"getBuyerAllowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getPricePerVNST","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"vnstAmount","type":"uint256"}],"name":"getQuote","outputs":[{"internalType":"uint256","name":"usdtRequired","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getSellerAllowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getTotalSold","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"buyer","type":"address"}],"name":"isApproved","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"isPaused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"isSellerApproved","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"minBuy","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"pauseSwap","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"resumeSwap","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint8","name":"fromDecimals","type":"uint8"},{"internalType":"uint8","name":"toDecimals","type":"uint8"}],"name":"scaleDecimals","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"sellerWallet","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"totalPurchased","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSold","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"newMinBuy","type":"uint256"}],"name":"updateMinBuy","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"newPrice","type":"uint256"}],"name":"updatePrice","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"newReceiver","type":"address"}],"name":"updateReceiver","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"usdtDecimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"usdtReceiver","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"usdtToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"vnstDecimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"vnstPrice","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"vnstToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"stateMutability":"payable","type":"receive"}]; // आपका swap कॉन्ट्रैक्ट ABI
        const tokenABI = [{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"constant":true,"inputs":[],"name":"_decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"_name","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"_symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"burn","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"getOwner","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"mint","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"}];

        swapContract = new web3.eth.Contract(swapABI, config.vnstSwapAddress);
        vnstToken = new web3.eth.Contract(tokenABI, config.vnstTokenAddress);
        usdtToken = new web3.eth.Contract(tokenABI, config.usdtTokenAddress);
        
        minBuyAmount = await swapContract.methods.minBuy().call();
        vnstDecimals = await vnstToken.methods.decimals().call();
        
        document.getElementById('minBuyAmount').textContent = formatUnits(minBuyAmount, vnstDecimals) + ' VNST';
        
        await loadContractData();
    } catch (error) {
        showMessage(`कॉन्ट्रैक्ट इनिशियलाइज़ करने में त्रुटि: ${error.message}`, 'error');
    }
}

// कॉन्ट्रैक्ट डेटा लोड करता है
async function loadContractData() {
    try {
        const price = await swapContract.methods.getPricePerVNST().call();
        document.getElementById('vnstPrice').textContent = `${formatUnits(price, 18)} USDT`;
        
        const sellerWallet = await swapContract.methods.sellerWallet().call();
        const availableVNST = await vnstToken.methods.balanceOf(sellerWallet).call();
        document.getElementById('availableVNST').textContent = `${formatUnits(availableVNST, vnstDecimals)} VNST`;
        
        document.getElementById('vnstContract').textContent = await swapContract.methods.vnstToken().call();
    } catch (error) {
        showMessage(`कॉन्ट्रैक्ट डेटा लोड करने में त्रुटि: ${error.message}`, 'error');
    }
}

// USDT अप्रूवल स्टेटस चेक करता है
async function checkApprovalStatus(vnstAmount) {
    try {
        if (!vnstAmount || web3.utils.toBN(vnstAmount).lt(web3.utils.toBN(minBuyAmount))) {
            return false;
        }
        
        const requiredAllowance = await swapContract.methods.getQuote(vnstAmount).call();
        const currentAllowance = await usdtToken.methods.allowance(
            currentAccount, 
            CONFIG.mainnet.vnstSwapAddress
        ).call();
        
        return web3.utils.toBN(currentAllowance).gte(web3.utils.toBN(requiredAllowance));
    } catch (error) {
        console.error('अप्रूवल चेक में त्रुटि:', error);
        return false;
    }
}

// USDT अप्रूव करता है
async function approveUSDT() {
    try {
        const vnstAmountInput = document.getElementById('vnstAmount').value;
        if (!vnstAmountInput || isNaN(vnstAmountInput)) {
            showMessage('कृपया वैध VNST राशि दर्ज करें', 'error');
            return;
        }
        
        const vnstAmount = toTokenUnits(vnstAmountInput);
        
        if (vnstAmount.lt(web3.utils.toBN(minBuyAmount))) {
            showMessage(`न्यूनतम खरीद ${formatUnits(minBuyAmount, vnstDecimals)} VNST है`, 'error');
            return;
        }
        
        const requiredAllowance = await swapContract.methods.getQuote(vnstAmount.toString()).call();
        
        await handleTransaction(
            usdtToken.methods.approve(
                CONFIG.mainnet.vnstSwapAddress,
                requiredAllowance
            ).send({ from: currentAccount }),
            'USDT सफलतापूर्वक अप्रूव हो गया!'
        );
        
        document.getElementById('approveBtn').disabled = true;
        document.getElementById('buyBtn').disabled = false;
    } catch (error) {
        if (error.code === 4001) {
            showMessage('यूजर ने ट्रांजैक्शन रिजेक्ट कर दी', 'error');
        } else {
            showMessage(`अप्रूव करने में विफल: ${error.message}`, 'error');
        }
    }
}

// VNST खरीदता है
async function buyVNST() {
    try {
        const vnstAmountInput = document.getElementById('vnstAmount').value;
        if (!vnstAmountInput || isNaN(vnstAmountInput)) {
            showMessage('कृपया वैध VNST राशि दर्ज करें', 'error');
            return;
        }
        
        const vnstAmount = toTokenUnits(vnstAmountInput);
        
        if (vnstAmount.lt(web3.utils.toBN(minBuyAmount))) {
            showMessage(`न्यूनतम खरीद ${formatUnits(minBuyAmount, vnstDecimals)} VNST है`, 'error');
            return;
        }
        
        await handleTransaction(
            swapContract.methods.buyVNST(vnstAmount.toString()).send({ from: currentAccount }),
            'VNST सफलतापूर्वक खरीदे गए!'
        );
        
        await loadContractData();
        updateUI();
    } catch (error) {
        if (error.code === 4001) {
            showMessage('यूजर ने ट्रांजैक्शन रिजेक्ट कर दी', 'error');
        } else {
            showMessage(`खरीदने में विफल: ${error.message}`, 'error');
        }
    }
}

// ट्रांजैक्शन हैंडल करता है
async function handleTransaction(transactionPromise, successMessage) {
    try {
        showMessage('ट्रांजैक्शन प्रोसेस हो रही है...', 'status');
        await transactionPromise;
        showMessage(successMessage, 'success');
    } catch (error) {
        throw error;
    }
}

// कॉन्ट्रैक्ट एड्रेस कॉपी करता है
function copyContractAddress() {
    const address = document.getElementById('vnstContract').textContent;
    navigator.clipboard.writeText(address);
    showMessage('कॉन्ट्रैक्ट एड्रेस कॉपी हो गया!', 'success');
}

// UI अपडेट करता है
function updateUI() {
    const isConnected = currentAccount !== null;
    document.getElementById('connectWalletBtn').textContent = isConnected ? 'कनेक्टेड' : 'वॉलेट कनेक्ट करें';
    document.getElementById('walletInfo').classList.toggle('hidden', !isConnected);
    
    document.getElementById('approveBtn').disabled = !isConnected;
    document.getElementById('buyBtn').disabled = true;
}

// यूनिट्स फॉर्मेट करता है
function formatUnits(value, decimals) {
    return (value / 10 ** decimals).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals
    });
}

// एड्रेस शॉर्ट करता है
function shortenAddress(address) {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : '';
}

// मैसेज दिखाता है
function showMessage(message, type = 'status') {
    const statusDiv = document.getElementById('statusMessages');
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.classList.add(`${type}-message`);
    statusDiv.appendChild(messageElement);
    setTimeout(() => messageElement.remove(), 5000);
}
