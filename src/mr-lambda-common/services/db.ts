import { getMrConnection } from './rds-mr';

export class Db {
	public async logEntry(
		jobRoot: string,
		folder: string,
		fileName: string,
		reviewId: string,
		status: string,
	): Promise<void> {
		const mysql = await getMrConnection();
		await mysql.query(`INSERT INTO mr_log (jobName, step, fileKey, reviewId, status)
			VALUES ('${jobRoot}', '${folder}', '${fileName}', '${reviewId}', '${status}')`);
	}

	public async updateEntry(
		jobRoot: string,
		folder: string,
		fileName: string,
		reviewId: string,
		status: string,
	): Promise<void> {
		const mysql = await getMrConnection();
		await mysql.query(`UPDATE mr_log SET status = '${status}' 
			WHERE jobName = '${jobRoot}' AND step = '${folder}' AND reviewId = '${reviewId}'`);
	}

	public async countFilesCompleted(jobName: string, step: string): Promise<number> {
		const mysql = await getMrConnection();
		const result: any = await mysql.query(`
			SELECT count(*) as count FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}'`);
		return parseInt(result[0].count);
	}

	public async hasEntry(jobName: string, step: string, reviewId: string): Promise<boolean> {
		const mysql = await getMrConnection();
		const result: any[] = await mysql.query(`
			SELECT count(*) as count 
			FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}' AND reviewId = '${reviewId}'`);
		return parseInt(result[0].count) > 0;
	}

	public async getFilesKeys(jobName: string, step: string): Promise<readonly string[]> {
		const mysql = await getMrConnection();
		const dbResult: any[] = await mysql.query(`
			SELECT concat(jobName, '/', step, '/', fileKey) as fileKey FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}'`);
		const result = dbResult.map(db => db.fileKey);
		return result as readonly string[];
	}
}
