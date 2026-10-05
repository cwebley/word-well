import Foundation
import Security

// Identities travel through anonymous pipes, never argv or a plaintext file.
// Never update/delete an item. A versioned identity must not be replaced.
func fail() -> Never { exit(1) }
guard let request = try? JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as? [String: String],
      let operation = request["operation"], let account = request["id"],
      account.range(of: "^ww-(dataset|storage)-v[1-9][0-9]*$", options: .regularExpression) != nil else { fail() }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "org.wordwell.private-age",
    kSecAttrAccount as String: account
]
if operation == "get" {
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { fail() }
    FileHandle.standardOutput.write(data)
} else if operation == "add", let identity = request["identity"],
          identity.range(of: "^AGE-SECRET-KEY-1[0-9A-Z]{58}$", options: .regularExpression) != nil {
    var item = query
    item[kSecValueData as String] = Data(identity.utf8)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { fail() }
} else { fail() }
