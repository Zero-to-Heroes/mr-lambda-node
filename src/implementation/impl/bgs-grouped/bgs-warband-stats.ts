/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { TotalDataTurnInfo } from '../../total-data-turn-info';
import { BgsCompsBuilder } from './../details/bgs-comps-builder';
import { BgsGroupedOperation } from './battlegrounds-turn-value-builder';

export class BgsWarbandStats extends BgsGroupedOperation {
	public getImplementationKey(): string {
		return 'bgs-warband-stats';
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

	protected getTableName(): string {
		return 'bgs_warband_stats';
	}
}
