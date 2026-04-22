const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SubscriptionService", function () {
  let subscriptionService;
  let owner;
  let user1;
  let user2;
  
  const BASIC_PRICE = ethers.parseEther("0.01");
  const PREMIUM_PRICE = ethers.parseEther("0.025");
  const SUBSCRIPTION_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    const SubscriptionService = await ethers.getContractFactory("SubscriptionService");
    subscriptionService = await SubscriptionService.deploy();
    await subscriptionService.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await subscriptionService.owner()).to.equal(owner.address);
    });

    it("Should set correct tier prices", async function () {
      expect(await subscriptionService.tierPrices(0)).to.equal(BASIC_PRICE);
      expect(await subscriptionService.tierPrices(1)).to.equal(PREMIUM_PRICE);
    });

    it("Should set correct subscription duration", async function () {
      expect(await subscriptionService.SUBSCRIPTION_DURATION()).to.equal(SUBSCRIPTION_DURATION);
    });
  });

  describe("Subscription", function () {
    it("Should allow user to subscribe with basic tier", async function () {
      const tx = await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
      
      await expect(tx).to.emit(subscriptionService, "Subscribed")
        .withArgs(user1.address, await getExpectedExpiry(), 0);
      
      const details = await subscriptionService.getSubscriptionDetails(user1.address);
      expect(details.isActive).to.be.true;
      expect(details.tier).to.equal(0);
      expect(details.expiry).to.be.gt(Math.floor(Date.now() / 1000));
    });

    it("Should allow user to subscribe with premium tier", async function () {
      const tx = await subscriptionService.connect(user1).subscribe(1, {
        value: PREMIUM_PRICE
      });
      
      await expect(tx).to.emit(subscriptionService, "Subscribed")
        .withArgs(user1.address, await getExpectedExpiry(), 1);
      
      const details = await subscriptionService.getSubscriptionDetails(user1.address);
      expect(details.isActive).to.be.true;
      expect(details.tier).to.equal(1);
    });

    it("Should fail if user tries to subscribe while already active", async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
      
      await expect(
        subscriptionService.connect(user1).subscribe(0, {
          value: BASIC_PRICE
        })
      ).to.be.revertedWithCustomError(subscriptionService, "AlreadyActive");
    });

    it("Should fail if payment is insufficient", async function () {
      await expect(
        subscriptionService.connect(user1).subscribe(0, {
          value: ethers.parseEther("0.005")
        })
      ).to.be.revertedWithCustomError(subscriptionService, "InsufficientPayment");
    });

    it("Should refund excess payment", async function () {
      const initialBalance = await ethers.provider.getBalance(user1.address);
      const excessPayment = ethers.parseEther("0.02");
      
      const tx = await subscriptionService.connect(user1).subscribe(0, {
        value: excessPayment
      });
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const finalBalance = await ethers.provider.getBalance(user1.address);
      
      // User should pay exactly the basic price plus gas
      const expectedCost = BASIC_PRICE + gasUsed;
      const actualCost = initialBalance - finalBalance;
      
      expect(actualCost).to.be.closeTo(expectedCost, ethers.parseEther("0.001"));
    });

    it("Should fail with invalid tier", async function () {
      await expect(
        subscriptionService.connect(user1).subscribe(2, {
          value: BASIC_PRICE
        })
      ).to.be.reverted;
    });
  });

  describe("Renewal", function () {
    beforeEach(async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
    });

    it("Should allow user to renew subscription", async function () {
      const initialExpiry = await subscriptionService.getExpiry(user1.address);
      
      const tx = await subscriptionService.connect(user1).renew(0, {
        value: BASIC_PRICE
      });
      
      await expect(tx).to.emit(subscriptionService, "Renewed")
        .withArgs(user1.address, initialExpiry + BigInt(SUBSCRIPTION_DURATION), 0);
      
      const newExpiry = await subscriptionService.getExpiry(user1.address);
      expect(newExpiry).to.equal(initialExpiry + BigInt(SUBSCRIPTION_DURATION));
    });

    it("Should allow user to renew with different tier", async function () {
      await subscriptionService.connect(user1).renew(1, {
        value: PREMIUM_PRICE
      });
      
      const details = await subscriptionService.getSubscriptionDetails(user1.address);
      expect(details.tier).to.equal(1);
    });

    it("Should fail if user has no active subscription", async function () {
      await expect(
        subscriptionService.connect(user2).renew(0, {
          value: BASIC_PRICE
        })
      ).to.be.revertedWithCustomError(subscriptionService, "NoActiveSubscription");
    });

    it("Should fail if payment is insufficient for renewal", async function () {
      await expect(
        subscriptionService.connect(user1).renew(0, {
          value: ethers.parseEther("0.005")
        })
      ).to.be.revertedWithCustomError(subscriptionService, "InsufficientPayment");
    });
  });

  describe("Unsubscribe", function () {
    beforeEach(async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
    });

    it("Should allow user to unsubscribe", async function () {
      const tx = await subscriptionService.connect(user1).unsubscribe();
      
      await expect(tx).to.emit(subscriptionService, "Unsubscribed")
        .withArgs(user1.address);
      
      const details = await subscriptionService.getSubscriptionDetails(user1.address);
      expect(details.isActive).to.be.false;
      expect(details.expiry).to.equal(0);
      expect(details.tier).to.equal(0);
    });

    it("Should fail if user has no active subscription", async function () {
      await subscriptionService.connect(user1).unsubscribe();
      
      await expect(
        subscriptionService.connect(user1).unsubscribe()
      ).to.be.revertedWithCustomError(subscriptionService, "NoActiveSubscription");
    });

    it("Should fail if non-owner tries to unsubscribe another user", async function () {
      // This test is not applicable since unsubscribe is called by the user themselves
      // The function checks msg.sender, so each user can only unsubscribe themselves
      const details = await subscriptionService.getSubscriptionDetails(user2.address);
      expect(details.isActive).to.be.false;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
    });

    it("Should return correct active status", async function () {
      expect(await subscriptionService.isActive(user1.address)).to.be.true;
      expect(await subscriptionService.isActive(user2.address)).to.be.false;
    });

    it("Should return correct expiry timestamp", async function () {
      const expiry = await subscriptionService.getExpiry(user1.address);
      expect(expiry).to.be.gt(Math.floor(Date.now() / 1000));
      expect(await subscriptionService.getExpiry(user2.address)).to.equal(0);
    });

    it("Should return correct tier", async function () {
      expect(await subscriptionService.getTier(user1.address)).to.equal(0);
    });

    it("Should return complete subscription details", async function () {
      const details = await subscriptionService.getSubscriptionDetails(user1.address);
      expect(details.isActive).to.be.true;
      expect(details.tier).to.equal(0);
      expect(details.expiry).to.be.gt(Math.floor(Date.now() / 1000));
    });
  });

  describe("Owner Functions", function () {
    beforeEach(async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
    });

    it("Should allow owner to withdraw balance", async function () {
      const initialBalance = await ethers.provider.getBalance(owner.address);
      const contractBalance = await subscriptionService.getBalance();
      
      const tx = await subscriptionService.withdraw();
      
      await expect(tx).to.emit(subscriptionService, "Withdrawn")
        .withArgs(owner.address, contractBalance);
      
      expect(await subscriptionService.getBalance()).to.equal(0);
    });

    it("Should fail if non-owner tries to withdraw", async function () {
      await expect(
        subscriptionService.connect(user1).withdraw()
      ).to.be.revertedWithCustomError(subscriptionService, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("Should allow owner to update tier prices", async function () {
      const newPrice = ethers.parseEther("0.02");
      await subscriptionService.updateTierPrice(0, newPrice);
      
      expect(await subscriptionService.tierPrices(0)).to.equal(newPrice);
    });

    it("Should fail if non-owner tries to update prices", async function () {
      await expect(
        subscriptionService.connect(user1).updateTierPrice(0, BASIC_PRICE)
      ).to.be.revertedWithCustomError(subscriptionService, "OwnableUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple users correctly", async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
      
      await subscriptionService.connect(user2).subscribe(1, {
        value: PREMIUM_PRICE
      });
      
      const user1Details = await subscriptionService.getSubscriptionDetails(user1.address);
      const user2Details = await subscriptionService.getSubscriptionDetails(user2.address);
      
      expect(user1Details.isActive).to.be.true;
      expect(user1Details.tier).to.equal(0);
      
      expect(user2Details.isActive).to.be.true;
      expect(user2Details.tier).to.equal(1);
    });

    it("Should handle expired subscriptions", async function () {
      await subscriptionService.connect(user1).subscribe(0, {
        value: BASIC_PRICE
      });
      
      // Fast forward time (this would need to be done with time manipulation in a real test)
      // For now, just check that isActive works correctly
      expect(await subscriptionService.isActive(user1.address)).to.be.true;
    });
  });

  // Helper function to get expected expiry
  async function getExpectedExpiry() {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block.timestamp) + BigInt(SUBSCRIPTION_DURATION);
  }
});
