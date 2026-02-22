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