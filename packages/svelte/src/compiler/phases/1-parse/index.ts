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
