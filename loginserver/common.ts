import Redis from 'ioredis';
import {Config} from './config-loader';

export const redis = new Redis(Config.redis);
