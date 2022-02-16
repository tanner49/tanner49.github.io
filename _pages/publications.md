---
layout: archive
title: "Publications"
permalink: /publications/
author_profile: true
---

### This is a selection of recent papers that represent my current research interests. See the CV page for a full list of my journa and conference presentations.

{% if author.googlescholar %}
  You can also find my articles on <u><a href="{{author.googlescholar}}">my Google Scholar profile</a>.</u>
{% endif %}

{% include base_path %}

{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}
