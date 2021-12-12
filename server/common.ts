import Redis from 'ioredis';
import * as pg from 'pg';

export const redis = new Redis(Config.redis);
export const pool = new pg.Pool(Config.pg);

export default exports;
