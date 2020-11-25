/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { S3 } from '../../../mr-lambda-common/services/s3';
import { formatDate } from '../../../mr-lambda-common/services/utils';
import { TotalDataTurnInfo } from '../../total-data-turn-info';
import { BgsTurnValueBuilder } from '../battlegrounds-turn-value-builder';

const s3 = new S3();

export class BgsDmgPerTurnOverTime extends BgsTurnValueBuilder {
	constructor() {
		super(
			'bgs-dmg-per-turn-over-time',
			20000,
			(miniReview: MiniReview) => {
				const formattedDate = miniReview.creationDate
					.toLocaleString('fr-fr', {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
					})
					.split('/')
					.reverse()
					.join('-');
				console.log('key', formattedDate, miniReview.creationDate);
				return formattedDate;
			},
			49534,
		);
	}

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const today = Date.now();
		const daysInPast = 100;
		const dates = [...Array(daysInPast).keys()].map(dayInPast => [
			formatDate(new Date(today - dayInPast * 24 * 60 * 60 * 1000)),
			formatDate(new Date(today - (dayInPast - 1) * 24 * 60 * 60 * 1000)),
		]);
		console.log('dates', dates);

		const queries = dates.map(
			pair => `
				SELECT reviewId FROM replay_summary
				WHERE gameMode = 'battlegrounds'
				AND creationDate >= '${pair[0]}'
				AND creationDate < '${pair[1]}'
				AND playerCardId like 'TB_BaconShop_HERO_%'
				AND playerCardId != 'TB_BaconShop_HERO_59t%'
				LIMIT 50
			`,
		);
		const mysql = await getConnection();
		const resultsArray: any[] = await Promise.all(
			queries.map(query => {
				console.log('running query', query);
				return mysql.query(query);
			}),
		);
		const dbResults: any[] = resultsArray.reduce((a, b) => a.concat(b), []);
		console.log('got db results', dbResults.length, dbResults.length > 0 && dbResults[0]);
		const result: readonly string[] = dbResults.map(result => result.reviewId);
		console.log('filtered db results', result.length);
		return result;
	}

	protected async extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]> {
		const dmgPerTurn: Map<number, number> = extractDmgPerTurn(replay, replayXml);

		const result = dmgPerTurn
			.map(
				(dmgPerTurn, turnNumber) =>
					({
						turn: turnNumber,
						totalDataPoints: 1,
						totalValue: dmgPerTurn,
					} as TotalDataTurnInfo),
			)
			.valueSeq()
			.toArray();
		console.log('result', result);
		return result;
	}

	protected getTotalDataPointsThreshold() {
		// Require at least 20 runs for the data to be valid
		return 8;
	}

	protected getInsertionQuery(
		creationDate: string,
		sortedValues: {
			key: string;
			turn: number;
			data: number;
		}[],
	): string {
		console.log('building csv', JSON.stringify(sortedValues, null, 4));
		const values = sortedValues.map(info => `${info.key},${info.turn},${info.data}`).join('\n');
		console.log('final values', values);
		s3.writeFile(values, 'com.zerotoheroes.mr', 'bgs-dmg-per-turn-over-time.csv');
		return null;
	}
}

const extractDmgPerTurn = (replay: Replay, replayXml: string): Map<number, number> => {
	return null;
};
