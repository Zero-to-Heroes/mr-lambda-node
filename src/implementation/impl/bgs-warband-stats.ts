/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { TotalDataTurnInfo } from '../total-data-turn-info';
import { BgsTurnValueBuilder } from './battlegrounds-turn-value-builder';
import { BgsCompsBuilder } from './details/bgs-comps-builder';

export class BgsWarbandStats extends BgsTurnValueBuilder {
	constructor() {
		super('bgs-warband-stats-2');
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
		console.log('result', result);
		return result;
	}

	protected getTotalDataPointsThreshold() {
		// Require at least 20 runs for the data to be valid
		return 20;
	}

	protected getInsertionQuery(
		creationDate: string,
		sortedValues: {
			key: string;
			turn: number;
			data: number;
		}[],
	): string {
		const values = sortedValues
			.map(info => `('${creationDate}', '${info.key}', '${info.turn}', '${info.data}')`)
			.join(',');
		return `
			INSERT INTO bgs_hero_warband_stats_2
			(creationDate, heroCardId, turn, totalStats)
			VALUES ${values}
		`;
	}
}
