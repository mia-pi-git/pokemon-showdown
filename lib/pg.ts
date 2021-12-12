import * as pg from 'pg';
import {SQLStatement, SQL} from 'sql-template-strings';

type SQLInput = string | number;

export class PGTable<T> {
	database: pg.Pool;
	name: string;
	primaryKeyName: string;
	constructor(
		name: string,
		primaryKeyName: string,
		database: pg.Pool
	) {
		this.name = name;
		this.database = database;
		this.primaryKeyName = primaryKeyName;
	}
	async selectOne(
		entries: string | string[],
		where?: SQLStatement
	): Promise<T | null> {
		const query = where || SQL``;
		query.append(' LIMIT 1');
		const rows = await this.selectAll(entries, query);
		return rows?.[0] || null;
	}
	selectAll(
		entries: string | string[],
		where?: SQLStatement
	): Promise<T[]> {
		const query = SQL`SELECT `;
		if (typeof entries === 'string') {
			query.append(' * ');
		} else {
			for (let i = 0; i < entries.length; i++) {
				const key = entries[i];
				query.append(this.format(key));
				if (typeof entries[i + 1] !== 'undefined') query.append(', ');
			}
			query.append(' ');
		}
		query.append(`FROM ${this.name} `);
		if (where) {
			query.append(' WHERE ');
			query.append(where);
		}
		return this.query(query).then(res => res.rows as T[]);
	}
	get(entries: string | string[], keyId: SQLInput) {
		const query = SQL``;
		query.append(this.format(this.primaryKeyName));
		query.append(SQL` = ${keyId}`);
		return this.selectOne(entries, query);
	}
	updateAll(toParams: Partial<T>, where?: SQLStatement, limit?: number) {
		const to = Object.entries(toParams);
		const query = SQL`UPDATE `;
		query.append(this.name + ' SET ');
		for (let i = 0; i < to.length; i++) {
			const [k, v] = to[i];
			query.append(`${this.format(k)} = `);
			query.append(SQL`${v}`);
			if (typeof to[i + 1] !== 'undefined') {
				query.append(', ');
			}
		}

		if (where) {
			query.append(` WHERE `);
			query.append(where);
		}
		if (limit) query.append(SQL` LIMIT ${limit}`);
		return this.query(query);
	}
	updateOne(to: Partial<T>, where?: SQLStatement) {
		return this.updateAll(to, where, 1);
	}
	deleteAll(where?: SQLStatement, limit?: number) {
		const query = SQL`DELETE FROM `;
		query.append(this.name);
		if (where) {
			query.append(' WHERE ');
			query.append(where);
		}
		if (limit) {
			query.append(SQL` LIMIT ${limit}`);
		}
		return this.query(query);
	}
	delete(keyEntry: SQLInput) {
		const query = SQL``;
		query.append(this.format(this.primaryKeyName));
		query.append(SQL` = ${keyEntry}`);
		return this.deleteOne(query);
	}
	deleteOne(where: SQLStatement) {
		return this.deleteAll(where, 1);
	}
	insert(colMap: Partial<T>, rest?: SQLStatement, isReplace = false) {
		const query = SQL``;
		query.append(`${isReplace ? 'REPLACE' : 'INSERT'} INTO ${this.name} (`);
		const keys = Object.keys(colMap);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			query.append(this.format(key));
			if (typeof keys[i + 1] !== 'undefined') query.append(', ');
		}
		query.append(') VALUES (');
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			query.append(SQL`${colMap[key as keyof T]}`);
			if (typeof keys[i + 1] !== 'undefined') query.append(', ');
		}
		query.append(') ');
		if (rest) query.append(rest);
		return this.query(query);
	}
	replace(cols: Partial<T>, rest?: SQLStatement) {
		return this.insert(cols, rest, true);
	}
	format(param: string) {
		// todo: figure out a better way to do this. backticks are only needed
		// for reserved words, but we tend to have a lot of those (like `session` in ntbb_sessions)
		// so for now + consistency's sake, we're going to keep this. but we might be able to hardcode that out?
		// not sure.
		return `\`${param}\``;
	}
	update(primaryKey: SQLInput, data: Partial<T>) {
		const query = SQL``;
		query.append(this.primaryKeyName + ' = ');
		query.append(SQL`${primaryKey}`);
		return this.updateOne(data, query);
	}

	// catch-alls for "we can't fit this query into any of the wrapper functions"
	query<R = T>(sql: SQLStatement) {
		return this.database.query<R>(sql);
	}
}
