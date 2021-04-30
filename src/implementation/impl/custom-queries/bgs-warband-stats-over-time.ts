/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { S3 } from '../../../mr-lambda-common/services/s3';
import { formatDate } from '../../../mr-lambda-common/services/utils';
import { TotalDataTurnInfo } from '../../total-data-turn-info';
import { BgsTurnValueBuilder } from '../battlegrounds-turn-value-builder';
import { BgsCompsBuilder } from '../details/bgs-comps-builder';

const s3 = new S3();

export class BgsWarbandStatsOverTime extends BgsTurnValueBuilder {
	constructor() {
		super(
			'bgs-warband-stats-over-time',
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

		const queries = dates.map(
			pair => `
				SELECT reviewId FROM replay_summary
				WHERE gameMode = 'battlegrounds'
				AND creationDate >= '${pair[0]}'
				AND creationDate < '${pair[1]}'
				AND playerCardId like 'TB_BaconShop_HERO_%'
				AND playerCardId != 'TB_BaconShop_HERO_59t%'
				LIMIT 1000
			`,
		);
		const mysql = await getConnection();
		const resultsArray: any[] = await Promise.all(
			queries.map(query => {
				return mysql.query(query);
			}),
		);
		const dbResults: any[] = resultsArray.reduce((a, b) => a.concat(b), []);
		const result: readonly string[] = dbResults.map(result => result.reviewId);
		return result;
	}

	protected async extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]> {
		const compsByTurn: Map<
			number,
			readonly { cardId: string; attack: number; health: number }[]
		> = await new BgsCompsBuilder().buildCompsByTurn(replay, replayXml);

		const result = compsByTurn
			.map((value, key) => value.reduce((acc, obj) => acc + (obj.attack || 0) + (obj.health || 0), 0))
			.map(
				(totalStatsForTurn, turnNumber) =>
					({
						turn: turnNumber,
						totalDataPoints: 1,
						totalValue: totalStatsForTurn,
					} as TotalDataTurnInfo),
			)
			.valueSeq()
			.toArray();
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
		const values = sortedValues.map(info => `${info.key},${info.turn},${info.data}`).join('\n');
		s3.writeFile(values, 'com.zerotoheroes.mr', 'bgs-warband-stats-over-time.csv');
		return null;
	}
}
