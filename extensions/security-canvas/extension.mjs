// Plugin extension paths are containers: the loader discovers immediate child
// directories and looks for extension.mjs in each. This shim bridges the plugin
// layout to the real entrypoint at the repository root, so that installing the
// repo URL and installing this subfolder both work.
import "../../extension.mjs";
