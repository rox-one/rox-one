import errno, json, pathlib, runpy, shutil, subprocess, sys, tempfile

source = pathlib.Path('/Users/t/Projects/rox-sso-ops-delivery-20261003/deploy/sw/pocket-sso/prepare-core.py')
with tempfile.TemporaryDirectory(prefix='pocket-core-fixed-review-') as scratch:
    root = pathlib.Path(scratch)
    destination = root/'race'
    original = shutil.copyfile
    observation = {}
    def inject_empty_destination(src, target, **kwargs):
        result = original(src,target,**kwargs)
        if pathlib.Path(target).name == 'Dockerfile.pocket':
            destination.mkdir()
            observation['createdInode'] = destination.stat().st_ino
        return result
    shutil.copyfile = inject_empty_destination
    previous_argv = sys.argv
    rejected = False
    try:
        sys.argv = [str(source),str(destination)]
        runpy.run_path(str(source),run_name='__main__')
    except OSError as error:
        rejected = error.errno == errno.EEXIST
    finally:
        sys.argv = previous_argv
        shutil.copyfile = original
    assert rejected and destination.is_dir() and not list(destination.iterdir())
    assert destination.stat().st_ino == observation['createdInode']
    assert not list(root.glob('.pocket-core-context-*'))
    print(json.dumps({'case':'destination-created-at-publication','rejected':True,'existingEmptyDirectoryInodePreserved':True,'scratchRemoved':True,'platform':sys.platform}))

    dangling = root/'dangling-link'
    indirect = root/'indirect-destination'
    dangling.symlink_to(indirect,target_is_directory=True)
    result = subprocess.run(['python3',str(source),str(dangling)],capture_output=True,text=True)
    assert result.returncode!=0 and dangling.is_symlink() and not indirect.exists()
    assert not list(root.glob('.pocket-core-context-*'))
    print(json.dumps({'case':'dangling-destination-symlink','rejected':True,'linkPreserved':True,'resolvedTargetAbsent':True,'scratchAbsent':True}))
