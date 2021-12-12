/**
 * Classes for interfacing with specific database tables.
 * Original design by Zarel in https://github.com/Zarel/telepic/blob/master/server/db.ts, redone by Mia
 * @author mia-pi-git
 */
import {Config} from './config-loader';
import {PGTable as DatabaseTable} from '../lib';
import * as pg from 'pg';

import type {LadderEntry} from './ladder';
import type {PreparedReplay, ReplayData} from './replays';
import type {UserInfo} from './user';

export const pool = new pg.Pool();

export const users = new DatabaseTable<UserInfo>('users', 'userid', pool);

export const ladder = new DatabaseTable<LadderEntry>(
	'ladder', 'entryid', Config.ladderdb ? new pg.Pool(Config.ladderdb) : pool
);

export const prepreplays = new DatabaseTable<PreparedReplay>(
	'prepreplays', 'id', Config.replaysdb ? new pg.Pool(Config.replaysdb) : pool
);

export const replays = new DatabaseTable<ReplayData>(
	'replays', 'id', Config.replaysdb ? new pg.Pool(Config.replaysdb) : pool
);

export const sessions = new DatabaseTable<{
	session: number;
	sid: string;
	userid: string;
	time: number;
	timeout: number;
	ip: string;
}>('sessions', 'session', pool);

export const userstats = new DatabaseTable<{
	id: number;
	serverid: string;
	usercount: number;
	date: number;
}>('userstats', 'id', pool);

export const loginthrottle = new DatabaseTable<{
	ip: string;
	count: number;
	time: number;
	lastuserid: string;
}>('loginthrottle', 'ip', pool);

export const usermodlog = new DatabaseTable<{
	entryid: number;
	userid: string;
	actorid: string;
	date: number;
	ip: string;
	entry: string;
}>('usermodlog', 'entryid', pool);

export const userstatshistory = new DatabaseTable<{
	id: number;
	date: number;
	usercount: number;
	programid: 'showdown' | 'po';
}>('userstatshistory', 'id', pool);
