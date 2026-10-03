import ast, ctypes, errno, hashlib, json, os, pathlib, sys, tempfile

source = pathlib.Path('/review/prepare-core.py')
raw = source.read_bytes()
tree = ast.parse(raw)
transaction = next(node for node in tree.body if isinstance(node,ast.Try))
publication = next(node for node in transaction.body if isinstance(node,ast.If) and isinstance(node.test,ast.Compare) and ast.unparse(node.test.left)=='sys.platform')
position = transaction.body.index(publication)
result_check = transaction.body[position+1]
assert ast.unparse(result_check.test) == 'result != 0'
code = compile(ast.Module(body=[publication,result_check],type_ignores=[]),str(source),'exec')
assert sys.platform.startswith('linux')
with tempfile.TemporaryDirectory(prefix='pocket-native-linux-publication-') as scratch:
    root = pathlib.Path(scratch)
    for mode in ['absent','empty-directory','file','dangling-link']:
        case=root/mode; case.mkdir(); temporary=case/'source'; temporary.mkdir(); (temporary/'sentinel').write_text('owned-source')
        destination=case/'destination'
        if mode=='empty-directory': destination.mkdir()
        elif mode=='file': destination.write_text('owned-existing-file')
        elif mode=='dangling-link': destination.symlink_to(case/'missing')
        before=destination.lstat().st_ino if os.path.lexists(destination) else None
        rejected=False
        try: exec(code,{'sys':sys,'os':os,'ctypes':ctypes,'temporary':temporary,'destination':destination})
        except OSError as error: rejected=error.errno==errno.EEXIST
        if mode=='absent': assert not rejected and not temporary.exists() and (destination/'sentinel').read_text()=='owned-source'
        else:
            assert rejected and destination.lstat().st_ino==before and (temporary/'sentinel').read_text()=='owned-source'
            if mode=='file': assert destination.read_text()=='owned-existing-file'
            if mode=='empty-directory': assert not list(destination.iterdir())
            if mode=='dangling-link': assert destination.is_symlink() and not destination.exists()
        print(json.dumps({'case':mode,'passed':True,'nativeLinuxNoClobberRejected':rejected,'sourceSha256':hashlib.sha256(raw).hexdigest(),'platform':sys.platform,'scope':'Exact source AST publication block, actual Linux ctypes renameat2 syscall, isolated tmpfs, network disabled.'}))
