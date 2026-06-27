export {};
import type { Application } from 'express';
import type { Server } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';

/**
 * AdminContext factory
 * Creates and holds all shared state for the admin server.
 */

const tokenStore = require('../../models/user-store/token-store');

export interface AdminContext {
    tokens: Set<string>;
    tokenUserMap: Map<string, any>;
    app: Application | null;
    server: Server | null;
    io: SocketIOServer | null;
    provider: any;
}

function createAdminContext(dataProvider: any): AdminContext {
    const tokens = new Set<string>();
    const tokenUserMap = new Map<string, any>();

    const allTokens = tokenStore.getAllTokens();
    for (const entry of allTokens) {
        tokens.add(entry.token);
        tokenUserMap.set(entry.token, entry.user);
    }

    return {
        tokens,
        tokenUserMap,
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}

module.exports = { createAdminContext };
