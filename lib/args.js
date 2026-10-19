/**
 * Flags may appear anywhere; everything that is not a flag is a positional
 * (<version-type> [commitMessage]).
 */
export function parseArgs(argv, interactive = true) {
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
            config.preId = argv[++i] ?? '';
        else if (arg.startsWith('-'))
            config.unknown.push(arg);
        else
            positionals.push(arg);
    }
    config.bumpType = positionals[0] ?? '';
    config.commitMessage = positionals[1] ?? '';
    return config;
}
//# sourceMappingURL=args.js.map