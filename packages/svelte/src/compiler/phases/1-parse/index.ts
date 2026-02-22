import type { AST } from '#compiler';
import type { Location } from 'locate-character';
import type * as ESTree from 'estree';

// @ts-expect-error acorn type definitions are borked in the release we use
import { isIdentifierStart, isIdentifierChar } from 'acorn';

import fragment from './state/fragment.js';
import { regex_whitespace } from '../patterns.js';
import * as e from '../../errors.js';
import { create_fragment } from './utils/create.js';
import read_options from './read/options.js';
import { is_reserved } from '../../../utils.js';
import { disallow_children } from '../2-analyze/visitors/shared/special-element.js';
import * as state from '../../state.js';

const regex_position_indicator = / \(\d+:\d+\)$/;

const regex_lang_attribute =
	/<!--[^]*?-->|<script\s+(?:[^>]*|(?:[^=>'"/]+=(?:"[^"]*"|'[^']*'|[^>\s]+)\s+)*)lang=(["'])?([^"' >]+)\1[^>]*>/g;

export class Parser {
	/** @readonly */
	template: string;

	/**
	 * Whether or not we're in loose parsing mode, in which
	 * case we try to continue parsing as much as possible
	 */
	loose: boolean;

	index = 0;

	/**
	 * Creates a minimal parser instance for CSS-only parsing.
	 * Skips Svelte component parsing setup.
	 */
	static forCss(source: string): Parser {
		const parser = Object.create(Parser.prototype) as Parser;
		parser.template = source;
		parser.index = 0;
		parser.loose = false;
		return parser;
	}

	/** Whether we're parsing in TypeScript mode */
	ts = false;

	stack: AST.TemplateNode[] = [];

	fragments: AST.Fragment[] = [];

	root!: AST.Root;

	meta_tags: Record<string, boolean> = {};

	last_auto_closed_tag: LastAutoClosedTag | undefined;

	constructor(template: string, loose: boolean) {
		if (typeof template !== 'string') {
			throw new TypeError('Template must be a string');
		}

		this.loose = loose;
		this.template = template.trimEnd();

		let match_lang: RegExpExecArray | null;

		do match_lang = regex_lang_attribute.exec(template);
		while (match_lang && match_lang[0][1] !== 's'); // ensure it starts with '<s' to match script tags

		regex_lang_attribute.lastIndex = 0; // reset matched index to pass tests - otherwise declare the regex inside the constructor

		this.ts = match_lang?.[2] === 'ts';

		this.root = {
			css: null,
			js: [],
			// @ts-ignore
			start: null,
			// @ts-ignore
			end: null,
			type: 'Root',
			fragment: create_fragment(),
			options: null,
			comments: [],
			metadata: {
				ts: this.ts
			}
		};

		this.stack.push(this.root);
		this.fragments.push(this.root.fragment);

		let state: ParserState = fragment;

		while (this.index < this.template.length) {
			state = state(this) || fragment;
		}

		if (this.stack.length > 1) {
			const current = this.current();

			if (this.loose) {
				(current as any).end = this.template.length;
			} else if ((current as any).type === 'RegularElement') {
				(current as any).end = (current as any).start + 1;
				e.element_unclosed(current as any, (current as any).name);
			} else {
				(current as any).end = (current as any).start + 1;
				e.block_unclosed(current as any);
			}
		}

		if (state !== fragment) {
			e.unexpected_eof(this.index);
		}

		// @ts-ignore
		this.root.start = 0;
		// @ts-ignore
		this.root.end = template.length;

		const options_index = this.root.fragment.nodes.findIndex((thing: any) => thing.type === 'SvelteOptions');
		if (options_index !== -1) {
			const options = this.root.fragment.nodes[options_index] as unknown as AST.SvelteOptionsRaw;
			this.root.fragment.nodes.splice(options_index, 1);
			this.root.options = read_options(options);

			disallow_children(options as any);

			// We need this for the old AST format
			Object.defineProperty(this.root.options, '__raw__', {
				value: options,
				enumerable: false
			});
		}
	}

	current(): AST.TemplateNode {
		return this.stack[this.stack.length - 1]!;
	}

	acorn_error(err: any): never {
		e.js_parse_error(err.pos, err.message.replace(regex_position_indicator, ''));
	}

	eat(str: string, required = false, required_in_loose = true): boolean {
		if (this.match(str)) {
			this.index += str.length;
			return true;
		}

		if (required && (!this.loose || required_in_loose)) {
			e.expected_token(this.index, str);
		}

		return false;
	}

	match(str: string): boolean {
		const length = str.length;
		if (length === 1) {
			// more performant than slicing
			return this.template[this.index] === str;
		}

		return this.template.slice(this.index, this.index + length) === str;
	}

	/**
	 * Match a regex at the current index
	 * Should have a ^ anchor at the start so the regex doesn't search past the beginning, resulting in worse performance
	 */
	match_regex(pattern: RegExp): string | null {
		const match = pattern.exec(this.template.slice(this.index));
		if (!match || match.index !== 0) return null;

		return match[0];
	}

	allow_whitespace(): void {
		while (this.index < this.template.length && regex_whitespace.test(this.template[this.index]!)) {
			this.index++;
		}
	}

	/**
	 * Search for a regex starting at the current index and return the result if it matches
	 * Should have a ^ anchor at the start so the regex doesn't search past the beginning, resulting in worse performance
	 */
	read(pattern: RegExp): string | null {
		const result = this.match_regex(pattern);
		if (result) this.index += result.length;
		return result;
	}

	read_identifier(): ESTree.Identifier & { start: number; end: number; loc: { start: Location; end: Location } } {
		const start = this.index;
		let end = start;
		let name = '';

		const code = this.template.codePointAt(this.index) as number;

		if (isIdentifierStart(code, true)) {
			end += code <= 0xffff ? 1 : 2;

			while (end < this.template.length) {
				const code = this.template.codePointAt(end) as number;

				if (!isIdentifierChar(code, true)) break;
				end += code <= 0xffff ? 1 : 2;
			}

			name = this.template.slice(start, end);
			this.index = end;

			if (is_reserved(name)) {
				e.unexpected_reserved_word(start, name);
			}
		}

		return {
			type: 'Identifier',
			name,
			start,
			end,
			loc: {
				start: state.locator(start),
				end: state.locator(end)
			}
		};
	}

	read_until(pattern: RegExp): string {
		if (this.index >= this.template.length) {
			if (this.loose) return '';
			e.unexpected_eof(this.template.length);
		}

		const start = this.index;
		const match = pattern.exec(this.template.slice(start));

		if (match) {
			this.index = start + match.index;
			return this.template.slice(start, this.index);
		}

		this.index = this.template.length;
		return this.template.slice(start);
	}

	require_whitespace(): void {
		if (!regex_whitespace.test(this.template[this.index]!)) {
			e.expected_whitespace(this.index);
		}

		this.allow_whitespace();
	}

	pop(): AST.TemplateNode | undefined {
		this.fragments.pop();
		return this.stack.pop();
	}

	append<T extends AST.Fragment['nodes'][number]>(node: T): T {
		this.fragments.at(-1)?.nodes.push(node);
		return node;
	}
}

export function parse(template: string, loose: boolean = false): AST.Root {
	state.set_source(template);

	const parser = new Parser(template, loose);
	return parser.root;
}

type ParserState = (parser: Parser) => ParserState | void;

interface LastAutoClosedTag {
	tag: string;
	reason: string;
	depth: number;
}