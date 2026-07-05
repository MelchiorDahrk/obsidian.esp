import { type CanvasNode, type EspCardMeta } from './model';

/**
 * Current espCard schema revision. Bump when the meta shape changes and
 * handle older revisions in {@link getCardMeta}.
 */
export const CARD_META_REV = 1;

/**
 * All reads and writes of provenance metadata go through these accessors so
 * the storage backend can be swapped (e.g. a sidecar map keyed by node id)
 * if an Obsidian release stops preserving unknown canvas node keys.
 */
export function getCardMeta(node: CanvasNode): EspCardMeta | null {
	const meta = node.espCard;
	if (!meta || typeof meta.role !== 'string' || typeof meta.rev !== 'number') {
		return null;
	}
	return meta;
}

export function setCardMeta(node: CanvasNode, meta: Omit<EspCardMeta, 'rev'>): void {
	node.espCard = { ...meta, rev: CARD_META_REV };
}
