import ast, os

SKIP = {'venv', '.venv', '__pycache__', 'site-packages', 'dist-packages',
        '.git', '.vscode', 'node_modules', 'migrations', 'instance', 'stuff'}

pkgs = set()
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in SKIP]
    for f in files:
        if not f.endswith('.py'):
            continue
        try:
            tree = ast.parse(open(os.path.join(root, f), encoding='utf-8').read())
        except Exception:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                for a in n.names:
                    pkgs.add(a.name.split('.')[0])
            elif isinstance(n, ast.ImportFrom) and n.module:
                pkgs.add(n.module.split('.')[0])

print('\n'.join(sorted(pkgs)))
