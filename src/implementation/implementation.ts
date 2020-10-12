import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BgsAvgStatsPerTurnPerHero } from './impl/battlegrounds-avg-stats-per-turn-per-hero';
import { BgsHeroesTribe } from './impl/bgs-heroes-tribe';
import { BgsTurnWinratePerHero } from './impl/bgs-turn-winrate-per-hero';
import { BuildAiDecklists } from './impl/build-ai-decklists';
import { BuildCustomQuery } from './impl/build-custom-query';

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
		case 'bgs-avg-stats-per-turn-per-hero':
			return new BgsAvgStatsPerTurnPerHero();
		case 'bgs-combat-winrate':
			return new BgsTurnWinratePerHero();
		case 'ai-decklist':
			return new BuildAiDecklists();
		case 'custom-query':
			return new BuildCustomQuery();
		default:
			throw new Error('Invalid implementation ' + implementationId);
	}
};
