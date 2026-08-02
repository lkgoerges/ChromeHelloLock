using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Security.Authentication.WebAuthn;

namespace ChromeHelloLock.NativeHost;

internal sealed unsafe class WebAuthnService
{
    private const string RelyingPartyId = "chrome-hello-lock.local";
    private const string RelyingPartyName = "Chrome Hello Lock";
    private const string Origin = "https://chrome-hello-lock.local";
    private const string PublicKeyCredentialType = "public-key";
    private const string Sha256 = "SHA-256";

    private const uint EntityInformationVersion = 1;
    private const uint ClientDataVersion = 1;
    private const uint CredentialVersion = 1;
    private const uint OptionsVersion = 1;
    private const uint PlatformAuthenticator = 1;
    private const uint UserVerificationRequired = 1;
    private const uint AttestationNone = 1;
    private const int CoseEs256 = -7;

    private const int NteNotFound = unchecked((int)0x80090011);
    private const int ErrorCancelled = unchecked((int)0x800704C7);
    private const int NteUserCancelled = unchecked((int)0x80090036);
    private const int ErrorTimeout = unchecked((int)0x800705B4);

    private static readonly JsonSerializerOptions StateJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly HWND ownerWindow;
    private readonly string statePath;

    public WebAuthnService(IntPtr ownerWindowHandle)
    {
        ownerWindow = (HWND)ownerWindowHandle;
        statePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ChromeHelloLock",
            "credential.json");
    }

    public bool HasCredential => LoadState() is not null;

    public WebAuthnResult Authenticate()
    {
        if (WebAuthnNative.WebAuthNGetApiVersionNumber() < 1)
        {
            return WebAuthnResult.Unavailable(
                "WebAuthnUnavailable",
                "This Windows version does not provide the Windows Hello WebAuthn API.");
        }

        CredentialState? state = LoadState();
        return state is null ? Enroll() : GetAssertion(state);
    }

    private WebAuthnResult Enroll()
    {
        byte[] userId = RandomNumberGenerator.GetBytes(32);
        byte[] clientDataJson = CreateClientData("webauthn.create");

        fixed (char* rpId = RelyingPartyId)
        fixed (char* rpName = RelyingPartyName)
        fixed (char* credentialType = PublicKeyCredentialType)
        fixed (char* hashAlgorithm = Sha256)
        fixed (char* userName = "local-user")
        fixed (char* displayName = "Windows user")
        fixed (byte* userIdPointer = userId)
        fixed (byte* clientDataPointer = clientDataJson)
        {
            var relyingParty = new WEBAUTHN_RP_ENTITY_INFORMATION
            {
                dwVersion = EntityInformationVersion,
                pwszId = rpId,
                pwszName = rpName,
            };
            var user = new WEBAUTHN_USER_ENTITY_INFORMATION
            {
                dwVersion = EntityInformationVersion,
                cbId = checked((uint)userId.Length),
                pbId = userIdPointer,
                pwszName = userName,
                pwszDisplayName = displayName,
            };
            var parameter = new WEBAUTHN_COSE_CREDENTIAL_PARAMETER
            {
                dwVersion = EntityInformationVersion,
                pwszCredentialType = credentialType,
                lAlg = CoseEs256,
            };
            var parameters = new WEBAUTHN_COSE_CREDENTIAL_PARAMETERS
            {
                cCredentialParameters = 1,
                pCredentialParameters = &parameter,
            };
            var clientData = new WEBAUTHN_CLIENT_DATA
            {
                dwVersion = ClientDataVersion,
                cbClientDataJSON = checked((uint)clientDataJson.Length),
                pbClientDataJSON = clientDataPointer,
                pwszHashAlgId = hashAlgorithm,
            };
            var options = new WEBAUTHN_AUTHENTICATOR_MAKE_CREDENTIAL_OPTIONS
            {
                dwVersion = OptionsVersion,
                dwTimeoutMilliseconds = 60_000,
                dwAuthenticatorAttachment = PlatformAuthenticator,
                dwUserVerificationRequirement = UserVerificationRequired,
                dwAttestationConveyancePreference = AttestationNone,
            };

            WEBAUTHN_CREDENTIAL_ATTESTATION* attestation = null;
            HRESULT result = WebAuthnNative.WebAuthNAuthenticatorMakeCredential(
                ownerWindow,
                in relyingParty,
                in user,
                in parameters,
                in clientData,
                options,
                out attestation);

            try
            {
                if (result.Failed || attestation is null)
                {
                    return Failure(result, enrolling: true);
                }

                byte[] credentialId = new ReadOnlySpan<byte>(
                    attestation->pbCredentialId,
                    checked((int)attestation->cbCredentialId)).ToArray();

                SaveState(new CredentialState(
                    Version: 1,
                    RelyingPartyId,
                    Convert.ToBase64String(userId),
                    Convert.ToBase64String(credentialId)));

                return WebAuthnResult.Success(
                    "Enrolled",
                    "Windows Hello was verified and the local credential was created.");
            }
            finally
            {
                if (attestation is not null)
                {
                    WebAuthnNative.WebAuthNFreeCredentialAttestation(attestation);
                }
            }
        }
    }

    private WebAuthnResult GetAssertion(CredentialState state)
    {
        byte[] credentialId;
        try
        {
            credentialId = Convert.FromBase64String(state.CredentialId);
        }
        catch (FormatException)
        {
            DeleteState();
            return WebAuthnResult.Failure(
                "CredentialStateInvalid",
                "The local credential record was invalid. Try again to create a new Windows Hello credential.");
        }

        byte[] clientDataJson = CreateClientData("webauthn.get");

        fixed (char* credentialType = PublicKeyCredentialType)
        fixed (char* hashAlgorithm = Sha256)
        fixed (byte* credentialIdPointer = credentialId)
        fixed (byte* clientDataPointer = clientDataJson)
        {
            var credential = new WEBAUTHN_CREDENTIAL
            {
                dwVersion = CredentialVersion,
                cbId = checked((uint)credentialId.Length),
                pbId = credentialIdPointer,
                pwszCredentialType = credentialType,
            };
            var credentials = new WEBAUTHN_CREDENTIALS
            {
                cCredentials = 1,
                pCredentials = &credential,
            };
            var clientData = new WEBAUTHN_CLIENT_DATA
            {
                dwVersion = ClientDataVersion,
                cbClientDataJSON = checked((uint)clientDataJson.Length),
                pbClientDataJSON = clientDataPointer,
                pwszHashAlgId = hashAlgorithm,
            };
            var options = new WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS
            {
                dwVersion = OptionsVersion,
                dwTimeoutMilliseconds = 60_000,
                CredentialList = credentials,
                dwAuthenticatorAttachment = PlatformAuthenticator,
                dwUserVerificationRequirement = UserVerificationRequired,
            };

            WEBAUTHN_ASSERTION* assertion = null;
            HRESULT result = WebAuthnNative.WebAuthNAuthenticatorGetAssertion(
                ownerWindow,
                RelyingPartyId,
                in clientData,
                options,
                out assertion);

            try
            {
                if (result.Failed || assertion is null)
                {
                    if (result.Value == NteNotFound)
                    {
                        DeleteState();
                        return WebAuthnResult.Failure(
                            "CredentialNotFound",
                            "The Windows Hello credential no longer exists. Try again to create a new one.");
                    }

                    return Failure(result, enrolling: false);
                }

                return WebAuthnResult.Success(
                    "Verified",
                    "Windows Hello verified the current user.");
            }
            finally
            {
                if (assertion is not null)
                {
                    WebAuthnNative.WebAuthNFreeAssertion(assertion);
                }
            }
        }
    }

    private static byte[] CreateClientData(string type)
    {
        string challenge = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        return JsonSerializer.SerializeToUtf8Bytes(new
        {
            type,
            challenge,
            origin = Origin,
            crossOrigin = false,
        });
    }

    private static WebAuthnResult Failure(HRESULT result, bool enrolling)
    {
        string errorName = WebAuthnNative.WebAuthNGetErrorName(result).ToString() ?? result.ToString();
        if (result.Value is ErrorCancelled or NteUserCancelled)
        {
            return WebAuthnResult.Failure("Canceled", "Windows Hello was canceled.");
        }

        if (result.Value == ErrorTimeout)
        {
            return WebAuthnResult.Failure("Timeout", "Windows Hello timed out. Try again.");
        }

        string operation = enrolling ? "create the local credential" : "verify the current user";
        return WebAuthnResult.Failure(
            errorName,
            $"Windows Hello could not {operation} ({errorName}, {result}).");
    }

    private CredentialState? LoadState()
    {
        if (!File.Exists(statePath)) return null;

        try
        {
            CredentialState? state = JsonSerializer.Deserialize<CredentialState>(
                File.ReadAllText(statePath),
                StateJsonOptions);
            return state is { Version: 1, RelyingPartyId: RelyingPartyId }
                && !string.IsNullOrWhiteSpace(state.CredentialId)
                ? state
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private void SaveState(CredentialState state)
    {
        string? directory = Path.GetDirectoryName(statePath);
        if (directory is not null) Directory.CreateDirectory(directory);
        File.WriteAllText(statePath, JsonSerializer.Serialize(state, StateJsonOptions));
    }

    private void DeleteState()
    {
        if (File.Exists(statePath)) File.Delete(statePath);
    }

    private sealed record CredentialState(
        int Version,
        string RelyingPartyId,
        string UserId,
        string CredentialId);
}

internal sealed record WebAuthnResult(bool Verified, bool Available, string Code, string Message)
{
    public static WebAuthnResult Success(string code, string message) =>
        new(true, true, code, message);

    public static WebAuthnResult Failure(string code, string message) =>
        new(false, true, code, message);

    public static WebAuthnResult Unavailable(string code, string message) =>
        new(false, false, code, message);
}
