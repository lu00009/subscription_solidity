const { ethers } = require("hardhat");

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
  
  // Save contract address to .env for frontend/backend
  const fs = require('fs');
  const envContent = `# Contract address (auto-generated)
CONTRACT_ADDRESS=${contractAddress}
REACT_APP_CONTRACT_ADDRESS=${contractAddress}
`;

  try {
    fs.writeFileSync('.env', envContent);
    console.log("\nContract address saved to .env file");
  } catch (error) {
    console.log("Could not write to .env file. Please manually add:");
    console.log(`CONTRACT_ADDRESS=${contractAddress}`);
  }

  return { contractAddress, subscriptionService };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
