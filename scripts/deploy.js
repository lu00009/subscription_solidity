const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

function updateEnvFile(filePath, updates) {
  const absolutePath = path.resolve(filePath);
  let content = "";

  if (fs.existsSync(absolutePath)) {
    content = fs.readFileSync(absolutePath, "utf8");
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const updatedKeys = new Set();

  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;

    const key = match[1];
    if (!(key in updates)) return line;

    updatedKeys.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  const normalized = nextLines.join("\n").replace(/\n*$/, "\n");
  fs.writeFileSync(absolutePath, normalized);
}

async function main() {
  console.log("Deploying SubscriptionService contract...");

  // Get the contract factory
  const SubscriptionService = await ethers.getContractFactory("SubscriptionService");

  // Deploy the contract
  const subscriptionService = await SubscriptionService.deploy();

  // Wait for deployment to complete
  await subscriptionService.waitForDeployment();

  const contractAddress = await subscriptionService.getAddress();
  
  console.log("SubscriptionService deployed to:", contractAddress);
  console.log("Transaction hash:", subscriptionService.deploymentTransaction().hash);
  
  // Log initial contract state
  console.log("\nInitial contract state:");
  console.log("Basic tier price:", ethers.formatEther(await subscriptionService.tierPrices(0)), "ETH");
  console.log("Premium tier price:", ethers.formatEther(await subscriptionService.tierPrices(1)), "ETH");
  console.log("Subscription duration:", await subscriptionService.SUBSCRIPTION_DURATION(), "seconds");
  
  // Save contract address for root, backend, and frontend environments
  try {
    updateEnvFile(".env", {
      CONTRACT_ADDRESS: contractAddress,
      REACT_APP_CONTRACT_ADDRESS: contractAddress
    });

    updateEnvFile("backend/.env", {
      PORT: "3003",
      CONTRACT_ADDRESS: contractAddress,
      RPC_URL: "http://127.0.0.1:8545"
    });

    updateEnvFile("frontend/.env", {
      REACT_APP_CONTRACT_ADDRESS: contractAddress,
      REACT_APP_NETWORK_ID: "1337"
    });

    console.log("\nContract address updated in:");
    console.log("- .env");
    console.log("- backend/.env");
    console.log("- frontend/.env");
  } catch (error) {
    console.log("Could not write environment files. Please manually add:");
    console.log(`CONTRACT_ADDRESS=${contractAddress}`);
    console.log(`REACT_APP_CONTRACT_ADDRESS=${contractAddress}`);
  }

  return { contractAddress, subscriptionService };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
