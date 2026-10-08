#include <node_api.h>
#import <Security/Security.h>
#import <AppKit/AppKit.h>

static napi_value disable_interaction(napi_env env, napi_callback_info info) {
  OSStatus status = SecKeychainSetUserInteractionAllowed(false);
  napi_value value;
  napi_create_int32(env, status, &value);
  return value;
}

static napi_value activation_policy(napi_env env, napi_callback_info info) {
  NSInteger policy = [[NSApplication sharedApplication] activationPolicy];
  napi_value value;
  napi_create_int32(env, (int32_t)policy, &value);
  return value;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value disable, activation;
  napi_create_function(env, "disableKeychainInteraction", NAPI_AUTO_LENGTH, disable_interaction, NULL, &disable);
  napi_create_function(env, "activationPolicy", NAPI_AUTO_LENGTH, activation_policy, NULL, &activation);
  napi_set_named_property(env, exports, "disableKeychainInteraction", disable);
  napi_set_named_property(env, exports, "activationPolicy", activation);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
