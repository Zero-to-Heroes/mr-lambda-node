import { parseHsReplayString } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MercsPveTreasures } from '../merc-pve-treasures';
import { replayXml } from './replay.xml';

const test = async () => {
	const xml = replayXml;
	const replay = parseHsReplayString(xml);
	// Val'anyr (LETL_938_01), Snep Freeze 3 (LETL_933_03), Banner of the Horde 3 (LETL_751_03)
	const sut = new MercsPveTreasures();
	const output = await sut.extractMetric(replay);
	console.log(JSON.stringify(output, null, 4));
};

test();
