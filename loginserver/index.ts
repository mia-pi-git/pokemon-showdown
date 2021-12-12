/**
 * Initialization.
 */
import {Router} from './server';
export const server = new Router();

console.log(`Server listening on ${server.port}`);

process.on('uncaughtException', (err: Error) => {
	Router.crashlog(err, 'The main process');
});

process.on('unhandledRejection', (err: Error) => {
	Router.crashlog(err, 'A main process promise');
});

// graceful shutdown.
process.on('SIGINT', () => {
	void server.close().then(async () => {
		// we are no longer accepting requests and all requests have been handled.
		// now it's safe to close DBs
		for (const database of require('pg')._pools as import('pg').Pool[]) {
			await database.end();
		}
		process.exit(0);
	});
});
