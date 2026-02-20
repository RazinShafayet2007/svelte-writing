
import type { LegacyRoot } from './types/legacy-nodes.js';
import type {
    CompileOptions,
    CompileResult,
    ValidatedCompileOptions,
    ModuleCompileOptions
} from '#compiler';
import type { AST } from './public.js';

import { walk as zimmerframe_walk } from 'zimmerframe';
import { convert } from './legacy.js';
import { parse as _parse, Parser } from './phases/1-parse/index.js';
import { remove_typescript_nodes } from './phases/1-parse/remove_typescript_nodes.js';
import { parse_stylesheet } from './phases/1-parse/read/style.js';
import { analyze_component, analyze_module } from './phases/2-analyze/index.js';
import { transform_component, transform_module } from './phases/3-transform/index.js';
import { validate_component_options, validate_module_options } from './validate-options.js';
import * as state from './state.js';

export { default as preprocess } from './preprocess/index.js';
export { print } from './print/index.js';

export function compile(source: string, options: CompileOptions): CompileResult {
    source = remove_bom(source);
    state.reset({ warning: options.warningFilter, filename: options.filename });
    const validated = validate_component_options(options, '');

    let parsed = _parse(source);

    const { customElement: customElementOptions, ...parsed_options } = parsed.options || {};

    const combined_options: ValidatedCompileOptions = {
        ...validated,
        ...parsed_options,
        customElementOptions
    };

    if (parsed.metadata.ts) {
		parsed = {
			...parsed,
			fragment: parsed.fragment && remove_typescript_nodes(parsed.fragment),
			instance: parsed.instance && remove_typescript_nodes(parsed.instance),
			module: parsed.module && remove_typescript_nodes(parsed.module)
		};
		if (combined_options.customElementOptions?.extend) {
			combined_options.customElementOptions.extend = remove_typescript_nodes(
				combined_options.customElementOptions?.extend
			);
		}
	}

    const analysis = analyze_component(parsed, source, combined_options);
	const result = transform_component(analysis, source, combined_options);
	result.ast = to_public_ast(source, parsed, options.modernAst);
	return result;
}

export function compileModule(source: string, options: ModuleCompileOptions): CompileResult {
	source = remove_bom(source);
	state.reset({ warning: options.warningFilter, filename: options.filename });
	const validated = validate_module_options(options, '');

	const analysis = analyze_module(source, validated);
	return transform_module(analysis, source, validated);
}

export interface ParseOptions {
	/**
	 * Unused and will be removed in Svelte 6.0.
	 * Kept here only for compatibility with the existing API surface.
	 */
	filename?: string;
	rootDir?: string;
	modern?: boolean;
	loose?: boolean;
}

// Overloads
export function parse(source: string, options: { filename?: string; modern: true; loose?: boolean }): AST.Root;
export function parse(
  source: string,
  options?: { filename?: string; modern?: false; loose?: boolean }
): Record<string, any>;

// Implementation
export function parse(source: string, { modern, loose }: ParseOptions = {}): AST.Root | LegacyRoot {
	source = remove_bom(source);
	state.reset({ warning: () => false, filename: undefined });

	const ast = _parse(source, loose);
	return to_public_ast(source, ast, modern);
}

export function parseCss(source: string): AST.CSS.StyleSheetFile {
	source = remove_bom(source);
	state.reset({ warning: () => false, filename: undefined });

	state.set_source(source);

	const parser = Parser.forCss(source);
	const children = parse_stylesheet(parser);

	return {
		type: 'StyleSheetFile',
		start: 0,
		end: source.length,
		children
	};
}

export function to_public_ast(source: string, ast: any, modern?: boolean): AST.Root | LegacyRoot {
	if (modern) {
		const clean = (node: any) => {
			delete node.metadata;
		};

		ast.options?.attributes.forEach((attribute: any) => {
			clean(attribute);
			clean(attribute.value);
			if (Array.isArray(attribute.value)) {
				attribute.value.forEach(clean);
			}
		});

		// remove things that we don't want to treat as public API
		return zimmerframe_walk(ast, null, {
			_(node, { next }) {
				clean(node);
				next();
			}
		});
	}

	return convert(source, ast);
}