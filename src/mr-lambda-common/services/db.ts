import { getConnection } from '../../mr-lambda-common/services/rds';

export class Db {
	public async logEntry(
		jobRoot: string,
		folder: string,
		fileName: string,
		reviewId: string,
		status: string,
	): Promise<void> {
		const mysql = await getConnection();
		await mysql.query(`INSERT INTO mr_log (jobName, step, fileKey, reviewId, status)
			VALUES ('${jobRoot}', '${folder}', '${fileName}', '${reviewId}', '${status}')`);
		console.log('saved entry in db', jobRoot, folder, fileName, reviewId, status);
	}

	public async updateEntry(
		jobRoot: string,
		folder: string,
		fileName: string,
		reviewId: string,
		status: string,
	): Promise<void> {
		const mysql = await getConnection();
		await mysql.query(`UPDATE mr_log SET status = '${status}' 
			WHERE jobName = '${jobRoot}' AND step = '${folder}' AND reviewId = '${reviewId}'`);
		console.log('updated entry in db', jobRoot, folder, fileName, reviewId, status);
	}

	public async countFilesCompleted(jobName: string, step: string): Promise<number> {
		const mysql = await getConnection();
		const result: any = await mysql.query(`
			SELECT count(*) as count FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}'`);
		console.log('counted files completed', jobName, step, result[0].count);
		return parseInt(result[0].count);
	}

	public async hasEntry(jobName: string, step: string, reviewId: string): Promise<boolean> {
		const mysql = await getConnection();
		const result: any[] = await mysql.query(`
			SELECT count(*) as count 
			FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}' AND reviewId = '${reviewId}'`);
		console.log('has entry', jobName, step, reviewId, result[0].count);
		return parseInt(result[0].count) > 0;
	}

	public async getFilesKeys(jobName: string, step: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		const dbResult: any[] = await mysql.query(`
			SELECT concat(jobName, '/', step, '/', fileKey) as fileKey FROM mr_log 
			WHERE jobName = '${jobName}' AND step = '${step}'`);
		const result = dbResult.map(db => db.fileKey);
		console.log('file keys', jobName, step, dbResult, result);
		return result as readonly string[];
	}
}
