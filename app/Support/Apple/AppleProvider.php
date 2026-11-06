<?php

namespace App\Support\Apple;

use Laravel\Socialite\Two\AbstractProvider;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as OAuthUser;
use LogicException;

/**
 * Sign in with Apple on the web, as a Socialite driver so it runs through
 * SocialAuthController alongside Google and Microsoft.
 *
 * Asking for the name and email obliges Apple to answer with a cross-site
 * form POST (response_mode=form_post). That POST carries no session cookie,
 * so it lands on AppleCallbackController, outside the session middleware,
 * which turns it into the ordinary GET callback this driver reads.
 */
class AppleProvider extends AbstractProvider
{
    protected $scopes = ['name', 'email'];

    protected $scopeSeparator = ' ';

    protected $encodingType = PHP_QUERY_RFC3986;

    protected function getAuthUrl($state)
    {
        return $this->buildAuthUrlFromBase('https://appleid.apple.com/auth/authorize', $state);
    }

    protected function getCodeFields($state = null)
    {
        return array_merge(parent::getCodeFields($state), ['response_mode' => 'form_post']);
    }

    protected function getTokenUrl()
    {
        return 'https://appleid.apple.com/auth/token';
    }

    protected function getUserByToken($token)
    {
        throw new LogicException('Apple has no userinfo endpoint; the ID token carries the person.');
    }

    protected function mapUserToObject(array $user)
    {
        return AppleSignIn::oauthUser($user, null);
    }

    /**
     * @throws InvalidStateException
     * @throws AppleSignInException
     */
    public function user()
    {
        if ($this->user) {
            return $this->user;
        }

        if ($this->hasInvalidState()) {
            throw new InvalidStateException;
        }

        $tokens = AppleSignIn::exchangeCode((string) $this->getCode(), $this->clientId, $this->redirectUrl);
        $claims = AppleSignIn::verifyIdToken((string) ($tokens['id_token'] ?? ''), $this->clientId);

        /** @var OAuthUser $user */
        $user = AppleSignIn::oauthUser($claims, AppleSignIn::nameFromUserField($this->request->input('user')), $tokens);

        return $this->user = $user;
    }
}
