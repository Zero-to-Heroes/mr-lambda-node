import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BattlegroundsGroupedQueries } from './impl/bgs-grouped/battlegrounds-grouped-queries';
import { BuildAiDecklists } from './impl/build-ai-decklists';
import { CasualDuelsTreasures } from './impl/casual-duels-treasures';
import { BgsDmgPerTurnOverTime } from './impl/custom-queries/bgs-damage-per-turn-over-time';
import { BgsWarbandStatsOverTime } from './impl/custom-queries/bgs-warband-stats-over-time';
import { HeroicDuelsTreasures } from './impl/heroic-duels-treasures';

export interface Implementation {
	loadReviewIds(query: string): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any>;
	mergeReduceEvents<T>(currentResult: ReduceOutput<T>, newResult: ReduceOutput<T>): Promise<ReduceOutput<T>>;
	transformOutput<T>(output: ReduceOutput<T>): Promise<ReduceOutput<T>>;
}

export const getImplementation = (implementationId: string): Implementation => {
	switch (implementationId) {
		case 'bgs-grouped-queries':
			return new BattlegroundsGroupedQueries();
		case 'casual-duels-treasure':
			return new CasualDuelsTreasures();
		case 'paid-duels-treasure':
			return new HeroicDuelsTreasures();
		case 'ai-decklist':
			return new BuildAiDecklists();
		// custom
		case 'warband-stats-over-time':
			return new BgsWarbandStatsOverTime();
		case 'bgs-dmg-per-turn-over-time':
			return new BgsDmgPerTurnOverTime();
		default:
			throw new Error('Invalid implementation ' + implementationId);
	}
};
