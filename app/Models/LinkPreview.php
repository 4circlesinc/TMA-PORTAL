<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'url_hash', 'url', 'status', 'site_name', 'title', 'description',
    'image_url', 'domain', 'favicon_url', 'fetched_at',
])]
class LinkPreview extends Model
{
    protected function casts(): array
    {
        return [
            'fetched_at' => 'datetime',
        ];
    }

    /** The shape the message bubble and the composer preview both render. */
    public function toCard(): array
    {
        return [
            'url' => $this->url,
            'siteName' => $this->site_name,
            'title' => $this->title,
            'description' => $this->description,
            'imageUrl' => $this->image_url,
            'domain' => $this->domain,
            'faviconUrl' => $this->favicon_url,
        ];
    }
}
