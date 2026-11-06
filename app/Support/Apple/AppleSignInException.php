<?php

namespace App\Support\Apple;

use RuntimeException;

/** A Sign in with Apple step that did not hold: a bad token, a refused code. */
class AppleSignInException extends RuntimeException {}
