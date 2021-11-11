import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { BattlegroundsGroupedQueries } from './impl/bgs-grouped/battlegrounds-grouped-queries';
import { BuildAiDecklists } from './impl/build-ai-decklists';
import { CasualDuelsTreasures } from './impl/casual-duels-treasures';
import { BgsDmgPerTurnOverTime } from './impl/custom-queries/bgs-damage-per-turn-over-time';
import { BgsTokenDamage } from './impl/custom-queries/bgs-token-damage';
import { BgsTotalBuff } from './impl/custom-queries/bgs-total-buff';
import { BgsWarbandStatsOverTime } from './impl/custom-queries/bgs-warband-stats-over-time';
import { MercsPveTreasures } from './impl/custom-queries/merc-pve-treasures';
import { HeroicDuelsTreasures } from './impl/heroic-duels-treasures';

export interface Implementation<T> {
	loadReviewIds(query: string): Promise<readonly string[]>;
	extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any>;
	mergeReduceEvents(currentResult: ReduceOutput<T>, newResult: ReduceOutput<T>): Promise<ReduceOutput<T>>;
	transformOutput(output: ReduceOutput<T>): Promise<ReduceOutput<T>>;
}

export const getImplementation = (implementationId: string): Implementation<any> => {
	switch (implementationId) {
		case 'bgs-grouped-queries':
			return new BattlegroundsGroupedQueries();
		case 'casual-duels-treasure':
			return new CasualDuelsTreasures();
		case 'heroic-duels-treasure':
			return new HeroicDuelsTreasures();
		case 'ai-decklist':
			return new BuildAiDecklists();
		// custom
		case 'warband-stats-over-time':
			return new BgsWarbandStatsOverTime();
		case 'bgs-dmg-per-turn-over-time':
			return new BgsDmgPerTurnOverTime();
		case 'bgs-token-damage':
			return new BgsTokenDamage();
		case 'bgs-total-buff':
			return new BgsTotalBuff();
		case 'merc-pve-treasures':
			return new MercsPveTreasures();
		default:
			throw new Error('Invalid implementation ' + implementationId);
	}
};
