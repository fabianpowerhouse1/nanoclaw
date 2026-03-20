import { NewMessage, RegisteredGroup } from './types.js';
export { escapeXml, formatMessages } from './router.js';
export declare function getAvailableGroups(): import('./container-runner.js').AvailableGroup[];
export declare function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void;
export declare function processGroupMessages(chatJid: string, messages: NewMessage[]): Promise<boolean>;
//# sourceMappingURL=index.d.ts.map