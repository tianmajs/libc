var crypto = require('crypto'),
	util = require('util');

var PATTERN_REQUIRE = /(^|[^\.])\brequire\s*\(\s*['"]([^'"]+?)['"]\s*\)/g,

	PATTERN_FN = /^\s*function.*?\{([\s\S]*)\}\s*$/,
	
	PATTERN_ILLEGAL = /[^\w]/g;

var TEMPLATE_FN = [
	'var %s = function () {',
		'var exports = {}, module = { exports: exports };',
		'%s',
		'return module.exports;',
	'}();'
].join('\n');

var TEMPLATE_AMD = [
	'define("%s", [ %s ], function (require, exports, module) {',
		'%s',
	'});'
].join('\n');

var TEMPLATE_WRAPPER = [
	'(function () {',
		'%s',
	'}());'
].join('\n');

/**
 * Convert module id to a auto-variable name.
 * @param id {string}
 * @return {string}
 */
function $(id) {
	return '$' + id.replace(PATTERN_ILLEGAL, '_');
}

/**
 * Calculate HASH value of input string.
 * @param str {string}
 * @return {string}
 */
function hash(str) {
	return crypto.createHash('sha1')
		.update(str, 'binary')
		.digest('hex');
}

/**
 * Convert AMD module to self-run function.
 * @param module {Object}
 * @return {string}
 */
function transform(module) {
	var id = $(module.id),
		
		code = module.code
			.replace(PATTERN_REQUIRE, function (all, prefix, id) {
				return prefix + $(id);
			});

	return util.format(TEMPLATE_FN, id, code);
}

/**
 * Parse module dependencies tree.
 * @param module {Array}
 * @return {Object}
 */
function parse(modules) {
	var map = {},
		externals = [],
		roots = [];
	
	modules.forEach(function (module) {
		map[module.id] = map[module.id] ? 'internal' : 'root'
		module.dependencies.forEach(function (id) {
			map[id] = map[id] ? 'internal' : 'external';
		});
	});
	
	Object.keys(map).forEach(function (id) {
		switch (map[id]) {
		case 'root':
			roots.push(id);
			break;
		case 'external':
			externals.push(id);
			break;
		}
	});
	
	return {
		externals: externals,
		roots: roots
	};
}

/**
 * Compact a single-interface bundle.
 * @param root {string}
 * @param externals {Array}
 * @param code {string}
 * @return {string}
 */
function simple(root, externals, code) {
	return util.format(TEMPLATE_AMD,
		
		root,
		
		externals.map(function (id) {
			return '"' + id + '"';
		}).join(', '),
		
		[
			externals.map(function (id) {
				return 'var ' + $(id) + ' = require("' + id + '");';
			}).join('\n'),
			
			code,
			
			'module.exports = ' + $(root) + ';'
		].join('\n')
	);
}

/**
 * Compact a multiple-interfaces bundle.
 * @param roots {Array}
 * @param externals {Array}
 * @param code {string}
 * @return {string}
 */
function complex(roots, externals, code) {
	var bundleId = hash(code);

	var output = [
		util.format(TEMPLATE_AMD,
			bundleId,
			
			externals.map(function (id) {
				return '"' + id + '"';
			}).join(', '),
			
			[
				externals.map(function (id) {
					return 'var ' + $(id) + ' = require("' + id + '");';
				}).join('\n'),
				
				code,
				
				roots.map(function (id) {
					return 'exports.' + $(id) + ' = ' + $(id) + ';';
				}).join('\n')
			].join('\n')
		)
	];
	
	roots.forEach(function (id) {
		output.push(util.format(TEMPLATE_AMD,
			id,
			
			'"' + bundleId + '"',
			
			'module.exports = require("' + bundleId + '").' + $(id)
		));
	});
	
	return output.join('\n');
}

/**
 * Split an AMD bundle.
 * @param code {string}
 * @return {Array}
 */
function split(code) {
	var queue = [];
		
	new Function('define', code).call(null, function (id, deps, fn) {
		queue.push({
			id: id,
			dependencies: deps,
			code: fn.toString().match(PATTERN_FN)[1]
		});
	});
	
	return queue;
}

/**
 * Convert an AMD bundle.
 * @param code {string}
 * @param [options] {Object|string}
 * @return {string}
 */
module.exports = function (code, options) {
	var modules = split(code),
		tree, entries;
		
	if (typeof options === 'string') {
		options = {
			mode: options
		};
	}
		
	code = modules.map(transform).join('\n');
	
	switch (options.mode || 'standalone') {
	case 'standalone':
		return util.format(TEMPLATE_WRAPPER, code);
	case 'compact':
		tree = parse(modules);
		entries = options.entries || tree.roots;
		if (entries.length > 1) {
			return complex(entries, tree.externals, code);
		} else {
			return simple(entries[0], tree.externals, code);
		}
	}
};