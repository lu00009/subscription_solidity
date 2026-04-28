// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SubscriptionService
 * @dev A smart contract for managing subscription payments with ETH
 * @notice Users can subscribe to a service with a 30-day duration
 */
contract SubscriptionService is Ownable, ReentrancyGuard {
    
    // State variables
    uint256 public constant SUBSCRIPTION_PRICE = 0.01 ether; // 0.01 ETH for subscription
    uint256 public constant SUBSCRIPTION_DURATION = 30 days; // 30 days subscription
    
    // Subscription tiers
    enum Tier { BASIC, PREMIUM }
    mapping(Tier => uint256) public tierPrices;
    
    // Storage
    struct Subscription {
        uint256 expiry;
        Tier tier;
    }
    
    mapping(address => Subscription) public subscriptions;
    
    // Events
    event Subscribed(address indexed user, uint256 expiry, Tier tier, uint256 amount);
    event Renewed(address indexed user, uint256 newExpiry, Tier tier, uint256 amount);
    event Unsubscribed(address indexed user);
    event Withdrawn(address indexed owner, uint256 amount);
    event TierPriceUpdated(Tier indexed tier, uint256 oldPrice, uint256 newPrice);
    event SubscriptionExpired(address indexed user, uint256 expiry);
    
    // Errors
    error AlreadyActive(address user);
    error InsufficientPayment(uint256 paid, uint256 required);
    error InvalidTier(uint8 tier);
    error NoActiveSubscription(address user);
    error InvalidPrice(uint256 price);
    
    constructor() Ownable(msg.sender) {
        // Initialize tier prices
        tierPrices[Tier.BASIC] = 0.01 ether;
        tierPrices[Tier.PREMIUM] = 0.025 ether;
    }
    
    /**
     * @dev Subscribe to the service with specified tier
     * @param _tier The subscription tier (0=Basic, 1=Premium)
     */
    function subscribe(Tier _tier) external payable nonReentrant {
        // Check if user already has active subscription
        if (subscriptions[msg.sender].expiry > block.timestamp) {
            revert AlreadyActive(msg.sender);
        }
        
        // Validate tier
        if (_tier != Tier.BASIC && _tier != Tier.PREMIUM) {
            revert InvalidTier(uint8(_tier));
        }
        
        // Check payment
        uint256 requiredPayment = tierPrices[_tier];
        if (msg.value < requiredPayment) {
            revert InsufficientPayment(msg.value, requiredPayment);
        }
        
        // Create subscription
        uint256 expiry = block.timestamp + SUBSCRIPTION_DURATION;
        subscriptions[msg.sender] = Subscription(expiry, _tier);
        
        emit Subscribed(msg.sender, expiry, _tier, requiredPayment);
        
        // Refund excess payment
        if (msg.value > requiredPayment) {
            payable(msg.sender).transfer(msg.value - requiredPayment);
        }
    }
    
    /**
     * @dev Renew an existing subscription
     * @param _tier The subscription tier to renew with
     */
    function renew(Tier _tier) external payable nonReentrant {
        Subscription storage userSub = subscriptions[msg.sender];
        
        // Check if user has active subscription
        if (userSub.expiry <= block.timestamp) {
            revert NoActiveSubscription(msg.sender);
        }
        
        // Validate tier
        if (_tier != Tier.BASIC && _tier != Tier.PREMIUM) {
            revert InvalidTier(uint8(_tier));
        }
        
        // Check payment
        uint256 requiredPayment = tierPrices[_tier];
        if (msg.value < requiredPayment) {
            revert InsufficientPayment(msg.value, requiredPayment);
        }
        
        // Extend subscription from current expiry
        userSub.expiry += SUBSCRIPTION_DURATION;
        userSub.tier = _tier;
        
        emit Renewed(msg.sender, userSub.expiry, _tier, requiredPayment);
        
        // Refund excess payment
        if (msg.value > requiredPayment) {
            payable(msg.sender).transfer(msg.value - requiredPayment);
        }
    }
    
    /**
     * @dev Unsubscribe from the service
     * Users can cancel their active subscription
     */
    function unsubscribe() external nonReentrant {
        // Check if user has active subscription
        if (subscriptions[msg.sender].expiry <= block.timestamp) {
            revert NoActiveSubscription(msg.sender);
        }
        
        // Delete subscription
        delete subscriptions[msg.sender];
        
        emit Unsubscribed(msg.sender);
    }
    
    /**
     * @dev Check if a user has an active subscription
     * @param _user The address to check
     * @return bool True if subscription is active
     */
    function isActive(address _user) external view returns (bool) {
        return subscriptions[_user].expiry > block.timestamp;
    }
    
    /**
     * @dev Get the expiry timestamp for a user's subscription
     * @param _user The address to check
     * @return uint256 Expiry timestamp
     */
    function getExpiry(address _user) external view returns (uint256) {
        return subscriptions[_user].expiry;
    }
    
    /**
     * @dev Get the tier for a user's subscription
     * @param _user The address to check
     * @return Tier The subscription tier
     */
    function getTier(address _user) external view returns (Tier) {
        return subscriptions[_user].tier;
    }
    
    /**
     * @dev Get subscription details for a user
     * @param _user The address to check
     * @return expiry Expiry timestamp
     * @return tier Subscription tier
     * @return isActive Whether subscription is currently active
     */
    function getSubscriptionDetails(address _user) external view returns (
        uint256 expiry,
        Tier tier,
        bool isActive
    ) {
        Subscription memory sub = subscriptions[_user];
        return (sub.expiry, sub.tier, sub.expiry > block.timestamp);
    }
    
    /**
     * @dev Withdraw contract balance (only owner)
     */
    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner()).transfer(balance);
            emit Withdrawn(owner(), balance);
        }
    }
    
    /**
     * @dev Get contract balance
     * @return uint256 Current contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Update tier prices (only owner)
     * @param _tier The tier to update
     * @param _newPrice The new price in wei
     */
    function updateTierPrice(Tier _tier, uint256 _newPrice) external onlyOwner {
        if (_newPrice == 0) {
            revert InvalidPrice(_newPrice);
        }
        
        uint256 oldPrice = tierPrices[_tier];
        tierPrices[_tier] = _newPrice;
        
        emit TierPriceUpdated(_tier, oldPrice, _newPrice);
    }
    
    /**
     * @dev Get total number of days remaining for a subscription
     * @param _user The address to check
     * @return uint256 Days remaining (0 if expired)
     */
    function getDaysRemaining(address _user) external view returns (uint256) {
        Subscription memory sub = subscriptions[_user];
        if (sub.expiry <= block.timestamp) {
            return 0;
        }
        return (sub.expiry - block.timestamp) / 1 days;
    }
    
    /**
     * @dev Check if subscription is expiring soon (within 7 days)
     * @param _user The address to check
     * @return bool True if expiring within 7 days
     */
    function isExpiringSoon(address _user) external view returns (bool) {
        Subscription memory sub = subscriptions[_user];
        if (sub.expiry <= block.timestamp) {
            return false;
        }
        uint256 daysRemaining = (sub.expiry - block.timestamp) / 1 days;
        return daysRemaining <= 7 && daysRemaining > 0;
    }
    
    /**
     * @dev Batch check subscription status for multiple addresses
     * @param _users Array of addresses to check
     * @return isActive Array of active status for each address
     */
    function batchCheckActive(address[] calldata _users) external view returns (bool[] memory isActive) {
        isActive = new bool[](_users.length);
        for (uint256 i = 0; i < _users.length; i++) {
            isActive[i] = subscriptions[_users[i]].expiry > block.timestamp;
        }
    }
}
