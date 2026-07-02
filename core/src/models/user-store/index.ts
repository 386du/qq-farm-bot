export {};
const auth = require('./auth');
const users = require('./users');
const cardClaim = require('./card-claim');
const invite = require('./invite');

// Initialize default admin on load
users.initDefaultAdmin();

module.exports = {
    // Auth
    validateUser: users.validateUser,
    registerUser: users.registerUser,
    renewUser: users.renewUser,
    getAllUsers: users.getAllUsers,
    updateUser: users.updateUser,
    editUser: users.editUser,
    getUserPublicProfile: users.getUserPublicProfile,
    updateUserProfile: users.updateUserProfile,
    getAllCards: users.getAllCards,
    createCard: users.createCard,
    createCardsBatch: users.createCardsBatch,
    updateCard: users.updateCard,
    deleteCard: users.deleteCard,
    deleteCardsBatch: users.deleteCardsBatch,
    deleteUser: users.deleteUser,
    changePassword: users.changePassword,
    resetPasswordByCard: users.resetPasswordByCard,
    DEFAULT_ACCOUNT_LIMIT: users.DEFAULT_ACCOUNT_LIMIT,
    addLoginLog: auth.addLoginLog,
    getLoginLogs: auth.getLoginLogs,
    clearLoginLogs: auth.clearLoginLogs,

    // Card claim
    getCardClaimStatus: cardClaim.getCardClaimStatus,
    setCardClaimStatus: cardClaim.setCardClaimStatus,
    claimCardByUA: cardClaim.claimCardByUA,
    getCardClaimRecords: cardClaim.getCardClaimRecords,
    clearExpiredClaimRecords: cardClaim.clearExpiredClaimRecords,

    // Invite
    ensureUserInviteCode: invite.ensureUserInviteCode,
    findUserByInviteCode: invite.findUserByInviteCode,
    getUserInviteInfo: invite.getUserInviteInfo,
    getAvailableRewards: invite.getAvailableRewards,
    getRewardState: invite.getRewardState,
    claimInviteReward: invite.claimReward,
    getAllInviteRecords: invite.getAllInviteRecords,
    getInviteConfig: invite.getInviteConfig,
    setInviteConfig: invite.setInviteConfig,
};
