
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