/* eslint-disable @typescript-eslint/no-use-before-define */
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { formatDate, http } from '../../mr-lambda-common/services/utils';

export const loadBgReviewIds = async (
	query: string,
	jobName: string,
	limit = 100000,
	lastPatch?: number,
): Promise<readonly string[]> => {
	const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
	const mysql = await getConnection();
	const lastJobQuery = `
		SELECT * FROM mr_job_summary
		WHERE jobName = '${jobName}'
		AND relevantPatch = '${lastBattlegroundsPatch}'
		ORDER BY lastDateRan DESC
		LIMIT 1
	`;
	const lastJobData: readonly any[] = await mysql.query(lastJobQuery);

	const startDate = lastJobData && lastJobData.length > 0 ? lastJobData[0].lastDateRan : null;
	const startDateStatemenet = startDate ? `AND creationDate >= '${formatDate(startDate)}' ` : '';

	// const formattedEndDate = formatDate(endDate);

	// Don't forget: keep only the top 4 in the query
	const defaultQuery = `
		SELECT reviewId FROM replay_summary
		WHERE gameMode = 'battlegrounds'
		AND buildNumber >= ${lastPatch ?? lastBattlegroundsPatch}
		AND (playerCardId like 'TB_BaconShop_HERO_%' OR playerCardId like 'BG%')
		AND playerRank >= 4000
		${startDateStatemenet}
		ORDER BY creationDate DESC
		LIMIT ${limit}
	`;
	query = query || defaultQuery;
	const dbResults: any[] = await mysql.query(query);
	const result: readonly string[] = dbResults.map(result => result.reviewId);
	return result;
};

export const loadMergedOutput = async <T>(
	jobName: string,
	output: ReduceOutput<T>,
	mergeReduceEvents: (o1: ReduceOutput<T>, o2: ReduceOutput<T>) => Promise<ReduceOutput<T>>,
): Promise<ReduceOutput<T>> => {
	const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
	const mysql = await getConnection();
	const lastJobQuery = `
		SELECT * FROM mr_job_summary
		WHERE jobName = '${jobName}'
		AND relevantPatch = '${lastBattlegroundsPatch}'
		ORDER BY lastDateRan DESC
		LIMIT 1
	`;
	const lastJobData: readonly any[] = await mysql.query(lastJobQuery);

	const lastOutput = lastJobData && lastJobData.length > 0 ? JSON.parse(lastJobData[0].dataAtJobEnd) : {};

	const mergedOutput = await mergeReduceEvents(output, lastOutput);

	const lastDateRan = new Date();
	const saveQuery = `
		INSERT INTO mr_job_summary (jobName, lastDateRan, relevantPatch, dataAtJobEnd)
		VALUES ('${jobName}', '${formatDate(lastDateRan)}', ${lastBattlegroundsPatch}, '${JSON.stringify(mergedOutput)}')
	`;
	await mysql.query(saveQuery);

	return mergedOutput;
};

export const getLastBattlegroundsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentBattlegroundsMetaPatch;
};
