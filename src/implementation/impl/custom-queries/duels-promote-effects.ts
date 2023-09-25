/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { BlockType, CardIds, GameTag } from '@firestone-hs/reference-data';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { http } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';

const validGameTagUpdates = [GameTag.RUSH, GameTag.DIVINE_SHIELD, GameTag.POISONOUS, GameTag.WINDFURY, GameTag.STEALTH];

export class DuelsPromoteEffects implements Implementation<Output> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const lastBattlegroundsPatch = await getLastDuelsPatch();
		const mysql = await getConnection();

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode IN ('duels', 'paid-duels')
			AND buildNumber >= ${lastBattlegroundsPatch}
			AND creationDate > DATE_SUB(NOW(), INTERVAL 30 DAY)
			AND playerCardId = 'PVPDR_Hero_Vanndar'
			ORDER BY id DESC
			LIMIT 1000
		`;
		query = query || defaultQuery;
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<Output> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		try {
			const elementTree = replay.replay;
			// Also includes opponent, but not an issue
			const promoteEntities = elementTree.findall(`.//FullEntity[@cardID='PVPDR_AV_Neutralp1']`);
			const entityIds = promoteEntities.map(entity => entity.get('id'));
			if (!entityIds?.length) {
				return null;
			}

			const heroPowerTriggerBlocks = elementTree
				.findall(`.//Block[@type="${BlockType.POWER}"]`)
				.filter(block => entityIds.includes(block.get('entity')));
			if (!heroPowerTriggerBlocks?.length) {
				return null;
			}

			const result: Output = {
				[validGameTagUpdates[0]]: 0,
				[validGameTagUpdates[1]]: 0,
				[validGameTagUpdates[2]]: 0,
				[validGameTagUpdates[3]]: 0,
				[validGameTagUpdates[4]]: 0,
			};
			for (const block of heroPowerTriggerBlocks) {
				const enchantment = block.find(
					`ShowEntity[@cardID='${CardIds.Promote_PromotedTavernBrawlEnchantment}']`,
				);
				const attachedToEntityId = enchantment.find(`Tag[@tag='${GameTag.ATTACHED}']`).get('value');
				const tagUpdated = block
					.findall(`TagChange[@entity='${attachedToEntityId}']`)
					.filter(tag => validGameTagUpdates.includes(+tag.get('tag')));
				if (tagUpdated.length !== 1) {
					console.error('invalid tag updates', tagUpdated);
				}
				const tag: GameTag = +tagUpdated[0].get('tag');
				result[tag] += 1;
			}

			return result;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	public async mergeReduceEvents(
		currentResult: ReduceOutput<Output>,
		newResult: ReduceOutput<Output>,
	): Promise<ReduceOutput<Output>> {
		if (!currentResult) {
			return newResult;
		}
		if (!newResult) {
			return currentResult;
		}
		return {
			output: this.mergeOutputs(currentResult.output, newResult.output),
		} as ReduceOutput<Output>;
	}

	private mergeOutputs(inputResult: Output, newResult: Output): Output {
		if (!inputResult) {
			return newResult;
		}
		if (!newResult) {
			return inputResult;
		}

		const result: Output = {
			[validGameTagUpdates[0]]: inputResult[validGameTagUpdates[0]] + newResult[validGameTagUpdates[0]],
			[validGameTagUpdates[1]]: inputResult[validGameTagUpdates[1]] + newResult[validGameTagUpdates[1]],
			[validGameTagUpdates[2]]: inputResult[validGameTagUpdates[2]] + newResult[validGameTagUpdates[2]],
			[validGameTagUpdates[3]]: inputResult[validGameTagUpdates[3]] + newResult[validGameTagUpdates[3]],
			[validGameTagUpdates[4]]: inputResult[validGameTagUpdates[4]] + newResult[validGameTagUpdates[4]],
		};
		return result;
	}

	public async transformOutput(output: ReduceOutput<Output>): Promise<ReduceOutput<Output>> {
		return output;
	}
}

const getLastDuelsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentDuelsMetaPatch;
};

interface Output {
	[gameTag: string]: number;
}
