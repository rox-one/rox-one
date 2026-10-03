import json, pathlib, runpy, subprocess, sys, tempfile

source = pathlib.Path('/Users/t/Projects/rox-sso-ops-delivery-20261003/deploy/sw/pocket-sso/prepare-core.py')
with tempfile.TemporaryDirectory(prefix='pocket-core-boundary-review-') as scratch:
    root = pathlib.Path(scratch)
    destination = root/'race'
    original = pathlib.Path.rename
    observation = {}
    def inject_empty_destination(self, target):
        target.mkdir()
        observation['createdInode'] = target.stat().st_ino
        result = original(self,target)
        observation['emptyDestinationReplaced'] = target.stat().st_ino != observation['createdInode']
        return result
    pathlib.Path.rename = inject_empty_destination
    previous_argv = sys.argv
    try:
        sys.argv = [str(source),str(destination)]
        runpy.run_path(str(source),run_name='__main__')
    finally:
        sys.argv = previous_argv
        pathlib.Path.rename = original
    assert observation['emptyDestinationReplaced']
    print(json.dumps({'case':'destination-created-at-publication','replacedExistingEmptyDestination':True,'scope':'Owned scratch-only deterministic race; no deployment or source change.'}))

    dangling = root/'dangling-link'
    indirect = root/'indirect-destination'
    dangling.symlink_to(indirect,target_is_directory=True)
    result = subprocess.run(['python3',str(source),str(dangling)],capture_output=True,text=True)
    assert result.returncode==0 and dangling.is_symlink() and indirect.is_dir()
    print(json.dumps({'case':'dangling-destination-symlink','acceptedAndWroteResolvedTarget':True,'scope':'Owned scratch-only path contract control; no deployment or source change.'}))
