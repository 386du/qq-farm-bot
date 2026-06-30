/**
 * 好友模块 - 统一导出
 */

export {
    removeKnownFriendGid,
    syncKnownFriendGidsFromFriends,
    syncKnownFriendGidsFromRecentVisitors,
} from './gid-manager';

export {
    checkFriends,
    getOperationLimits,
    isHelpExpLimitReached,
    onFriendApplicationReceived,
    refreshFriendCheckLoop,
    runBadOnceOnStartup,
    startFriendCheckLoop,
    stopFriendCheckLoop,
} from './scheduler';

export {
    acceptFriendApplications,
    clearFriendsListCache,
    doFriendOperation,
    getFriendApplicationsList,
    getFriendLandsDetail,
    getFriendsList,
    rejectFriendApplications,
} from './visit-strategy';
