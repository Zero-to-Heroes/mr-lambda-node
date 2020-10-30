import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BgsHeroesTribe } from './impl/bgs-heroes-tribe';
import { BgsCombatWinrate } from './impl/bgs-turn-winrate-per-hero';
import { BgsWarbandStats } from './impl/bgs-warband-stats';
import { BuildAiDecklists } from './impl/build-ai-decklists';
import { BgsWarbandStatsOverTime } from './impl/custom-queries/bgs-warband-stats-over-time';
import { DuelsTreasures } from './impl/duels-treasures';

export interface Implementation {
	loadReviewIds(query: string): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any>;
	mergeReduceEvents<T>(currentResult: ReduceOutput<T>, newResult: ReduceOutput<T>): Promise<ReduceOutput<T>>;
	transformOutput<T>(output: ReduceOutput<T>): Promise<ReduceOutput<T>>;
}

export const getImplementation = (implementationId: string): Implementation => {
	switch (implementationId) {
		case 'bgs-heroes-tribe':
			return new BgsHeroesTribe();
		case 'bgs-warband-stats':
			return new BgsWarbandStats();
		case 'bgs-combat-winrate':
			return new BgsCombatWinrate();
		case 'duels-treasure':
			return new DuelsTreasures();
		case 'ai-decklist':
			return new BuildAiDecklists();
		case 'warband-stats-over-time':
			return new BgsWarbandStatsOverTime();
		default:
			throw new Error('Invalid implementation ' + implementationId);
	}
};
