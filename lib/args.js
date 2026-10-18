/**
 * Flags may appear anywhere; everything that is not a flag is a positional
 * (<version-type> [commitMessage]).
 */
export function parseArgs(argv, interactive = true) {
    var _a, _b, _c;
    const config = {
        bumpType: '',
        commitMessage: '',
        preId: '',
        verbose: false,
        stashChanges: false,
        forceBranch: false,
        nonInteractive: !interactive,
        help: false,
        setupWorkflows: false,
        unknown: [],
    };
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h' || arg === '--help')
            config.help = true;
        else if (arg === '-v' || arg === '--verbose')
            config.verbose = true;
        else if (arg === '--setup-workflows')
            config.setupWorkflows = true;
        else if (arg === '--force-branch')
            config.forceBranch = true;
        else if (arg === '-y' || arg === '--yes')
            config.nonInteractive = true;
        else if (arg === '--push')
            config.push = true;
        else if (arg === '--no-push')
            config.push = false;
        else if (arg.startsWith('--preid='))
            config.preId = arg.slice('--preid='.length);
        else if (arg === '--preid')
            config.preId = (_a = argv[++i]) !== null && _a !== void 0 ? _a : '';
        else if (arg.startsWith('-'))
            config.unknown.push(arg);
        else
            positionals.push(arg);
    }
    config.bumpType = (_b = positionals[0]) !== null && _b !== void 0 ? _b : '';
    config.commitMessage = (_c = positionals[1]) !== null && _c !== void 0 ? _c : '';
    return config;
}
//# sourceMappingURL=args.js.map